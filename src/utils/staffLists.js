// The staff lists a deactivate / reactivate changes. Settings → Staff (and Attendance) read
// ["staff"], Accountant Log reads ["accountant-log-watched"], and the Team Attendance roster
// on the Settings staff tab reads ["staff-attendance-team", period]. Each query stays fresh
// for 30s (App.jsx), so a flip on one screen must refresh the others by name.
export function refreshStaffLists(qc) {
  qc.invalidateQueries({ queryKey: ["staff"] });
  qc.invalidateQueries({ queryKey: ["accountant-log-watched"] });
  qc.invalidateQueries({ queryKey: ["staff-attendance-team"] });
}
