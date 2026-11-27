// Pure three-way merge. The baseline is the last acknowledged cloud value.
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const isFeeSource = row => row && typeof row.src === 'string' && row.src.indexOf('fees:') === 0;
const isDeleted = row => !!(row && (row.deleted_at || row.deleted === true));
const updatedAt = row => String(row && (row.updated_at || row.created_at) || '');
const feeId = src => 'fee_' + encodeURIComponent(src);

function preferFeeRow(a, b) {
  if (isDeleted(a) !== isDeleted(b)) return isDeleted(a) ? a : b;
  const ta = updatedAt(a), tb = updatedAt(b);
  if (ta !== tb) return ta > tb ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

function normalizeLedger(rows) {
  if (!Array.isArray(rows)) return rows;
  const out = [], feeRows = new Map();
  rows.forEach(row => {
    if (!isFeeSource(row)) { out.push(row); return; }
    const normalized = Object.assign({}, row, { id: feeId(row.src) });
    const prev = feeRows.get(row.src);
    feeRows.set(row.src, prev ? preferFeeRow(prev, normalized) : normalized);
  });
  return out.concat(Array.from(feeRows.values()));
}

function itemKey(key, row) {
  if (!row || typeof row !== 'object') return JSON.stringify(row);
  if (key === 'gg_ledger' && isFeeSource(row)) return 'fee-src:' + row.src;
  if (key === 'gg_records' && row.member_id && row.item_code && row.biz_date) return JSON.stringify([row.member_id, row.item_code, row.biz_date]);
  if (key === 'gg_weights' && row.member_id && row.ym) return JSON.stringify([row.member_id, row.ym]);
  if (key === 'gg_snapshots') return row.type + ':' + row.key;
  if (key === '__history') return row.effectiveFrom;
  return row.target_id || row.record_id || row.id || JSON.stringify(row);
}
function indexed(key, rows) {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach(row => {
    const id = itemKey(key, row), prev = map.get(id);
    if (!prev || String(row.updated_at || row.created_at || '') >= String(prev.updated_at || prev.created_at || '')) map.set(id, row);
  });
  return map;
}
function merge(key, base, local, remote) {
  // Normalize before all equality shortcuts so duplicate legacy fee IDs cannot survive.
  if (key === 'gg_ledger') {
    base = normalizeLedger(base);
    local = normalizeLedger(local);
    remote = normalizeLedger(remote);
  }
  if (same(local, base)) return remote;
  if (same(remote, base) || same(local, remote)) return local;
  if (Array.isArray(local) && Array.isArray(remote)) {
    const b = indexed(key, base), l = indexed(key, local), r = indexed(key, remote), out = [];
    new Set([...b.keys(), ...l.keys(), ...r.keys()]).forEach(id => {
      let before = b.get(id);
      const left = l.get(id), right = r.get(id);
      // Two clients may add the same effective date from the same earlier policy.
      // Compare their fields against that earlier policy, not against an empty object.
      if (key === '__history' && !before && left && right) {
        const earlier = [...b.values(), ...[...l.values()].filter(v => same(v, r.get(v.effectiveFrom)))]
          .filter(v => v.effectiveFrom < id).sort((a, z) => a.effectiveFrom.localeCompare(z.effectiveFrom));
        if (earlier.length) before = { effectiveFrom: id, value: earlier[earlier.length - 1].value };
      }
      let value;
      if (key === 'gg_ledger' && isFeeSource(left) && isFeeSource(right)) value = preferFeeRow(left, right);
      else if (key === 'gg_ledger' && isFeeSource(left) && isDeleted(left)) value = left;
      else if (key === 'gg_ledger' && isFeeSource(right) && isDeleted(right)) value = right;
      else if (same(left, before)) value = right;
      else if (same(right, before) || same(left, right)) value = left;
      else if (!left || !right) value = left; // An explicit local deletion wins a concurrent edit.
      else if (key === '__history') value = merge('history-version', before, left, right);
      else if (left.updated_at || right.updated_at) value = String(left.updated_at || '') >= String(right.updated_at || '') ? left : right;
      else value = merge('row', before, left, right);
      if (value !== undefined) out.push(value);
    });
    return out;
  }
  if (object(local) && object(remote)) {
    const out = {};
    new Set([...Object.keys(base || {}), ...Object.keys(local), ...Object.keys(remote)]).forEach(k => {
      const value = merge(k, base && base[k], local[k], remote[k]);
      if (value !== undefined) out[k] = value;
    });
    return out;
  }
  return local;
}
function mergeRecords(local, remote) { return merge('gg_records', undefined, local || [], remote || []); }
module.exports = { merge, mergeRecords };
