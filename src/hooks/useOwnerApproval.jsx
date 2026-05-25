// MP-OWNER-PIN-APPROVAL: promise-based hook that pops the
// OwnerApprovalModal and resolves with a fresh approval token. Cleaner
// than wiring modal state by hand at every call site.
//
//   const { requestApproval, modal } = useOwnerApproval();
//
//   async function handleSave() {
//     try {
//       const { token } = await requestApproval({
//         actionType:   "edit_customer_credit",
//         targetTable:  "pa_customers",
//         targetId:     customer.id,
//         context:      { credit_limit_old: ..., credit_limit_new: ... },
//         description:  "Raise credit limit from 10,000 to 50,000 FCFA",
//       });
//       await api.patch(`/customers/${customer.id}`, body, {
//         headers: { "Approval-Token": token },
//       });
//     } catch (e) {
//       if (e?.code === "cancelled") return; // user closed modal
//       throw e;
//     }
//   }
//
//   return <>{modal}{...page}</>;
import { useState, useRef } from "react";
import OwnerApprovalModal from "../components/common/OwnerApprovalModal";

export default function useOwnerApproval() {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState(null);
  // Hold the resolve/reject pair across renders so the modal's
  // callbacks settle the same promise the caller is awaiting.
  const settleRef = useRef(null);

  const requestApproval = (opts) => {
    return new Promise((resolve, reject) => {
      settleRef.current = { resolve, reject };
      setConfig(opts);
      setOpen(true);
    });
  };

  const onApproved = (token, approverId) => {
    const s = settleRef.current;
    settleRef.current = null;
    setOpen(false);
    setConfig(null);
    s?.resolve({ token, approverId });
  };

  const onClose = () => {
    const s = settleRef.current;
    settleRef.current = null;
    setOpen(false);
    setConfig(null);
    // Standardised cancellation shape. Callers check `e?.code === 'cancelled'`.
    const err = new Error("cancelled");
    err.code = "cancelled";
    s?.reject(err);
  };

  const modal = (
    <OwnerApprovalModal
      open={open}
      onClose={onClose}
      title={config?.title}
      actionDescription={config?.description}
      actionType={config?.actionType}
      targetTable={config?.targetTable}
      targetId={config?.targetId}
      context={config?.context}
      onApproved={onApproved}
    />
  );

  return { requestApproval, modal };
}
