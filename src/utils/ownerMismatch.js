// OWNER CONFIRM-IN-PLACE (Peter, 2026-10-04) — the two pure decisions the screens
// and the offline queue share. No imports, so the release check drives the REAL
// functions rather than a copy.

// True when the owner's count is short on any line — the SAME predicate the server
// uses (good ≠ sent and good + damaged < sent). Only possible when the sent figures
// are on the device, i.e. the owner dispatched this transfer himself (/incoming does
// not blind a dispatcher's own transfer); otherwise false, and the server's 409
// remains the check.
export function ownerShortLocal(tr, lines) {
  if (!tr || tr.quantities_hidden) return false;
  const items = tr.pa_transfer_items || [];
  return (lines || []).some(l => {
    const it = items.find(i => i.id === l.item_id);
    if (!it || it.quantity === undefined || it.quantity === null) return false;
    const sent = Number(it.quantity) || 0;
    const good = Number(l.received_quantity) || 0, dmg = Number(l.damaged_quantity) || 0;
    return good !== sent && good + dmg < sent;
  });
}

// A queued receipt or recount the server refused with owner_mismatch_confirm —
// nothing was written. Returns what the screens need to label and answer it, or
// null for any other row.
export function ownerMismatchOf(row) {
  if (!row || row.status === 'sent') return null;
  let err = null; try { err = JSON.parse(row.last_error || 'null'); } catch { err = null; }
  if (!err || err.body?.code !== 'owner_mismatch_confirm') return null;
  const m = /^\/transfers\/([^/]+)\/(confirm-receipt|recount)\/?$/.exec(row.endpoint || '');
  if (!m) return null;
  let payload = {}; try { payload = JSON.parse(row.payload_json || '{}'); } catch { payload = {}; }
  return { transferId: m[1], kind: m[2] === 'recount' ? 'recount' : 'confirm', transferNumber: payload.transfer_number || null,
           message_en: err.body.message_en, message_fr: err.body.message_fr || err.body.message };
}
