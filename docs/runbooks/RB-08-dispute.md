# RB-08 Dispute received

Alerts: `dispute.created` (SEV2), `dispute.due_soon` (SEV2, 72 h and 24 h before the evidence deadline), `dispute.lost` (SEV3).

## What happened

With destination charges, Stripe debits the **platform** for the disputed amount plus the CA$15 fee as soon as the dispute opens. This is already in the ledger (`dispute_expense`), and an evidence pack has been assembled.

## 1. Review the evidence

`/ops/disputes` → the dispute. The pack holds the order, the lines with final weights, the receipt email, the timeline and the **handover record** (who checked the pickup code, and when). That record is the main defence against "not received".

| Reason | Strongest evidence |
|---|---|
| `product_not_received` | Handover record (named staff, time, code verified) |
| `fraudulent` | 3-D Secure result, pickup code, customer history |
| `product_unacceptable` | Replacement approvals, refunds already given, support issue history |
| `duplicate` / `credit_not_processed` | The single capture and the refunds in the ledger |

## 2. Submit

**Submit evidence to Stripe** before the deadline. Submission is final. Don't submit if the order had no handover (e.g. a no-show); accept the loss instead.

## 3. Liability

Set liability per the matrix in [ORDERS_AND_FULFILMENT](../domains/ORDERS_AND_FULFILMENT.md). If the merchant is liable (e.g. items missing), a lost dispute is recovered from them by a transfer reversal; otherwise the platform keeps the expense.

## 4. Outcome

- **Won:** Stripe returns the funds; `charge.dispute.funds_reinstated` posts the ledger credit automatically.
- **Lost:** the expense stays; a merchant-liable loss is reversed from the merchant's transfer.

Walked through 2026-09-29 as a read-through against the evidence pack and the dispute handlers. The flow (pay with `4000 0000 0000 0259`, capture, the dispute appears, evidence submitted) is the back-office E2E journey `tests/e2e/backoffice.spec.ts`, green at G5 with the payment simulator.
