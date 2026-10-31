import { useState } from "react";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { type Payment } from "./api";
import { FamilyReceiptDetail } from "./FamilyFeeRecords";
import { FeePaymentCorrectionDialog } from "./FeePaymentCorrectionDialog";
import type { PersonFeeInvoice } from "./personFeesApi";
import "./family-fees.css";

export function PersonFeeReceiptDetail({ schoolId, payment, invoice, allowCorrections = false, receiptHref, onReload }: {
  schoolId: string; payment: Payment; invoice?: PersonFeeInvoice; allowCorrections?: boolean; receiptHref: (id: string) => string | undefined; onReload: () => Promise<unknown>;
}) {
  const [correcting, setCorrecting] = useState(false), environment = useExecutionEnvironment();
  const readOnly = environment.mode === "simulation" && (environment.unavailable || ["stopped", "completed"].includes(environment.runStatus ?? ""));
  return <div className="person-fee-receipt-detail">
    <FamilyReceiptDetail payment={payment} invoice={invoice} receiptHref={receiptHref} headerActions={allowCorrections && !readOnly && (payment.can_reverse === true || payment.can_replace === true) ? <button className="is-secondary" type="button" onClick={() => setCorrecting(true)}>Correct receipt</button> : null} />
    {correcting ? <FeePaymentCorrectionDialog schoolId={schoolId} payment={payment} onClose={() => setCorrecting(false)} onReload={onReload} /> : null}
  </div>;
}
