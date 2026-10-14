// Fix 2 (Peter's staging test): a money WARNING the cashier must act on ("only X was still
// owed — give Y back") is bold yellow, never the green success style, and stays up long
// enough to read out to the customer.
import toast from "react-hot-toast";

export const WARNING_TOAST_STYLE = {
  background: "#fef3c7", color: "#78350f", border: "2px solid #f59e0b",
  fontWeight: 700, fontSize: "14px", borderRadius: "12px",
};

export function warningToast(message, opts = {}) {
  return toast(message, { icon: "⚠️", duration: 15000, style: WARNING_TOAST_STYLE, ...opts });
}
