export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type AssetCategory = 'Nakit' | 'Altın' | 'Fon' | 'Hisse' | 'Araç' | 'BES' | 'Diğer'
export type AssetUnit = 'TRY' | 'gram' | 'adet'
export type CashCurrency = 'TRY' | 'USD' | 'EUR' | 'GBP'
export type CardType = 'banka_karti' | 'kredi_karti'
export type PaymentCategory = 'Fatura' | 'Dijital üyelik' | 'Kira / aidat' | 'Sigorta' | 'Vergi / devlet' | 'Eğitim' | 'Sağlık' | 'Diğer'
export type LoanStatus = 'active' | 'closed'
export type DebtDirection = 'borç_aldım' | 'borç_verdim'
export type DebtValueType = 'TRY' | 'doviz' | 'gram_altin' | 'ceyrek_altin'
export type DebtStatus = 'açık' | 'kapandı'
export type PaymentStatus = 'bekliyor' | 'ödendi'
export type PaymentRecurrence = 'none' | 'monthly'
export type PaymentMethod = 'manual' | 'bank_auto'
export type PaymentAmountStatus = 'exact' | 'estimated'
export type LoanInstallmentStatus = 'bekliyor' | 'ödendi'
export type CardInstallmentStatus = 'scheduled' | 'posted' | 'paid'
export type CardExpenseStatus = 'provision' | 'posted' | 'cancelled'
export type CardStatementStatus = 'open' | 'paid'
export type SavingsGoalStatus = 'active' | 'completed'
export type SavingsGoalValueType = 'TRY' | 'gram_altin' | 'ceyrek_altin' | 'composite'
export type TransactionHistoryType = 'payment' | 'transfer' | 'loan' | 'debt' | 'card'
export type UpcomingDismissalSource = 'payment' | 'card' | 'loan_installment' | 'debt'

export type BaseRow = {
  id: string
  user_id: string
  created_at: string
  updated_at: string
}

export type Asset = BaseRow & {
  name: string
  category: AssetCategory
  amount: number
  unit: AssetUnit
  currency: CashCurrency | null
  /** BIST ticker without .IS suffix (Hisse only). */
  symbol: string | null
  /** Average purchase cost per share/unit in TRY (Hisse and ledger-managed Altın). */
  unit_cost: number | null
  estimated_value_try: number
  auto_valued: boolean
  /** When 'gold_ledger', this row is an aggregate maintained from gold_lots (do not hand-edit). */
  source: string | null
  note: string | null
}

export type GoldType = 'gram' | 'ceyrek'

export type GoldLot = BaseRow & {
  /** Purchase date; null when unknown. */
  purchase_date: string | null
  gold_type: GoldType
  /** Karat (e.g. 24, 22); informational. */
  ayar: number | null
  quantity: number
  /** TRY paid per unit at purchase; null when the cost is unknown. */
  unit_price: number | null
  note: string | null
}

export type Card = BaseRow & {
  bank_name: string
  card_name: string
  card_type: CardType
  holder_name: string | null
  limit_group_name: string | null
  current_balance: number
  credit_limit: number
  debt_amount: number
  statement_debt_amount: number
  current_period_spending: number
  provision_amount: number
  statement_day: number | null
  due_day: number | null
  note: string | null
}

export type CardExpense = BaseRow & {
  card_id: string
  statement_archive_id: string | null
  spent_at: string
  amount: number
  description: string
  category: string
  installment_count: number
  installment_amount: number
  status: CardExpenseStatus
  posted_at: string | null
  note: string | null
  transaction_fingerprint: string | null
}

export type Budget = BaseRow & {
  month: string
  category: string
  limit_amount: number
  note: string | null
}

export type SavingsGoal = BaseRow & {
  name: string
  value_type: SavingsGoalValueType
  target_amount: number
  current_amount: number
  estimated_value_try: number | null
  auto_valued: boolean
  target_date: string | null
  status: SavingsGoalStatus
  note: string | null
}

export type SavingsGoalComponent = BaseRow & {
  goal_id: string
  label: string | null
  value_type: Exclude<SavingsGoalValueType, 'composite'>
  target_amount: number
  current_amount: number
  sort_order: number
}

export type CardInstallment = BaseRow & {
  card_id: string
  card_expense_id: string | null
  statement_archive_id: string | null
  installment_no: number
  installment_count: number
  due_month: string
  amount: number
  description: string
  category: string
  status: CardInstallmentStatus
  posted_at: string | null
  paid_at: string | null
  note: string | null
}

export type CardStatementArchive = BaseRow & {
  card_id: string
  period_year: number
  period_month: number
  statement_date: string
  due_date: string | null
  statement_debt_amount: number
  current_period_spending: number
  total_debt_amount: number
  status: CardStatementStatus
  paid_at: string | null
  payment_source_card_id: string | null
  reconciled_bank_amount: number | null
  reconciled_at: string | null
  reconciliation_note: string | null
  note: string | null
}

export type Loan = BaseRow & {
  bank_name: string
  loan_name: string
  total_amount: number
  remaining_amount: number
  monthly_payment: number
  installment_day: number | null
  start_date: string | null
  end_date: string | null
  remaining_installments: number
  status: LoanStatus
  note: string | null
}

export type LoanInstallment = BaseRow & {
  loan_id: string
  installment_no: number
  due_date: string
  amount: number
  status: LoanInstallmentStatus
  paid_at: string | null
  note: string | null
}

export type Debt = BaseRow & {
  person_name: string
  direction: DebtDirection
  value_type: DebtValueType
  currency: CashCurrency | null
  amount: number
  estimated_value_try: number
  auto_valued: boolean
  due_date: string | null
  status: DebtStatus
  note: string | null
}

export type Payment = BaseRow & {
  title: string
  category: PaymentCategory
  amount: number
  amount_status: PaymentAmountStatus
  due_date: string
  status: PaymentStatus
  payment_method: PaymentMethod
  recurrence: PaymentRecurrence
  recurrence_day: number | null
  recurrence_end_date: string | null
  auto_source_card_id: string | null
  note: string | null
}

export type TransactionHistory = BaseRow & {
  occurred_at: string
  type: TransactionHistoryType
  title: string
  amount: number | null
  source_table: string | null
  source_id: string | null
  note: string | null
}

export type CardLedgerKind = 'opening' | 'debit' | 'credit' | 'adjustment'

/**
 * Append-only event log of credit-card debt changes (roadmap A2). Each row is
 * one change captured atomically by a trigger on `cards`. `amount_kurus` is
 * signed integer kuruş: +debit (debt up), -credit (debt down). The card's debt
 * equals the sum of its events (see utils/cardLedger.ts).
 */
export type CardLedger = BaseRow & {
  card_id: string
  occurred_at: string
  kind: CardLedgerKind
  amount_kurus: number
  note: string | null
  source_table: string | null
  source_id: string | null
}

export type AccountLedgerKind = 'opening' | 'deposit' | 'withdrawal' | 'adjustment'

/**
 * Append-only event log of bank-account balance changes (roadmap Faz 3). Each
 * row is one change captured atomically by a trigger on `cards`. `amount_kurus`
 * is signed integer kuruş: +deposit (balance up), -withdrawal (balance down).
 * The account's balance equals the sum of its events (see utils/accountLedger.ts).
 */
export type AccountLedger = BaseRow & {
  card_id: string
  occurred_at: string
  kind: AccountLedgerKind
  amount_kurus: number
  note: string | null
  source_table: string | null
  source_id: string | null
}

/**
 * One Web Push subscription (roadmap Y1). The browser's PushManager output:
 * `endpoint` + the two encryption keys (`p256dh`, `auth`). One row per device;
 * the scheduled `push-notify` edge function reads these to send notifications.
 */
export type PushSubscription = BaseRow & {
  endpoint: string
  p256dh: string
  auth: string
  user_agent: string | null
}

export type NotificationLog = {
  id: string
  user_id: string
  notification_type: string
  reference_id: string
  sent_at: string
}

export type ReconciliationTarget = 'balance' | 'debt'

/**
 * One live-balance reconciliation event (roadmap A3): a snapshot comparing the
 * app's current figure (bank account current_balance or credit-card
 * debt_amount) against the real figure the user read in their banking app.
 * `drift` = app_amount - real_amount, stored as a point-in-time fact.
 */
export type AccountReconciliation = BaseRow & {
  card_id: string
  reconciled_at: string
  target: ReconciliationTarget
  app_amount: number
  real_amount: number
  drift: number
  note: string | null
}

export type NetWorthSnapshot = BaseRow & {
  snapshot_date: string
  net_worth: number
  gold_try: number | null
  usd_try: number | null
}

export type DismissedUpcomingItem = {
  id: string
  user_id: string
  created_at: string
  item_key: string
  source: UpcomingDismissalSource
}

export type SalaryHistory = BaseRow & {
  title: string
  amount: number
  effective_date: string
  note: string | null
}

type Table<Row, Insert, Update> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

type NullableKeys<T> = {
  [K in keyof T]-?: null extends T[K] ? K : never
}[keyof T]

type WithBaseInsert<T> = Omit<T, keyof BaseRow | NullableKeys<T>> & Partial<Pick<T, NullableKeys<T>>> & {
  id?: string
  user_id: string
  created_at?: string
  updated_at?: string
}

type WithBaseUpdate<T> = Partial<Omit<T, keyof BaseRow>> & {
  updated_at?: string
}

export type Database = {
  public: {
    Tables: {
      assets: Table<Asset, WithBaseInsert<Asset>, WithBaseUpdate<Asset>>
      cards: Table<Card, WithBaseInsert<Card>, WithBaseUpdate<Card>>
      card_expenses: Table<CardExpense, WithBaseInsert<CardExpense>, WithBaseUpdate<CardExpense>>
      budgets: Table<Budget, WithBaseInsert<Budget>, WithBaseUpdate<Budget>>
      savings_goals: Table<SavingsGoal, WithBaseInsert<SavingsGoal>, WithBaseUpdate<SavingsGoal>>
      savings_goal_components: Table<SavingsGoalComponent, WithBaseInsert<SavingsGoalComponent>, WithBaseUpdate<SavingsGoalComponent>>
      card_installments: Table<CardInstallment, WithBaseInsert<CardInstallment>, WithBaseUpdate<CardInstallment>>
      card_statement_archives: Table<CardStatementArchive, WithBaseInsert<CardStatementArchive>, WithBaseUpdate<CardStatementArchive>>
      loans: Table<Loan, WithBaseInsert<Loan>, WithBaseUpdate<Loan>>
      loan_installments: Table<LoanInstallment, WithBaseInsert<LoanInstallment>, WithBaseUpdate<LoanInstallment>>
      debts: Table<Debt, WithBaseInsert<Debt>, WithBaseUpdate<Debt>>
      payments: Table<Payment, WithBaseInsert<Payment>, WithBaseUpdate<Payment>>
      transaction_history: Table<TransactionHistory, WithBaseInsert<TransactionHistory>, WithBaseUpdate<TransactionHistory>>
      salary_history: Table<SalaryHistory, WithBaseInsert<SalaryHistory>, WithBaseUpdate<SalaryHistory>>
      net_worth_snapshots: Table<NetWorthSnapshot, WithBaseInsert<NetWorthSnapshot>, WithBaseUpdate<NetWorthSnapshot>>
      gold_lots: Table<GoldLot, WithBaseInsert<GoldLot>, WithBaseUpdate<GoldLot>>
      card_ledger: Table<CardLedger, WithBaseInsert<CardLedger>, WithBaseUpdate<CardLedger>>
      account_ledger: Table<AccountLedger, WithBaseInsert<AccountLedger>, WithBaseUpdate<AccountLedger>>
      account_reconciliations: Table<
        AccountReconciliation,
        WithBaseInsert<AccountReconciliation>,
        WithBaseUpdate<AccountReconciliation>
      >
      push_subscriptions: Table<PushSubscription, WithBaseInsert<PushSubscription>, WithBaseUpdate<PushSubscription>>
      notification_log: Table<
        NotificationLog,
        Omit<NotificationLog, 'id' | 'sent_at'> & { id?: string; sent_at?: string },
        Partial<Omit<NotificationLog, 'id' | 'user_id'>>
      >
      dismissed_upcoming_items: Table<
        DismissedUpcomingItem,
        Omit<DismissedUpcomingItem, 'id' | 'created_at'> & { id?: string; created_at?: string },
        Partial<Omit<DismissedUpcomingItem, 'id' | 'user_id' | 'created_at'>> & { created_at?: string }
      >
    }
    Views: Record<string, never>
    Functions: {
      add_card_expense: {
        Args: {
          p_card_id: string
          p_amount: number
          p_description: string
          p_spent_at?: string
          p_installment_count?: number
          p_category?: string
          p_status?: CardExpenseStatus
        }
        Returns: CardExpense
      }
      cancel_card_expense: {
        Args: {
          p_expense_id: string
        }
        Returns: CardExpense
      }
      cancel_card_provision: {
        Args: {
          p_expense_id: string
        }
        Returns: CardExpense
      }
      cut_card_statement: {
        Args: {
          p_card_id: string
        }
        Returns: CardStatementArchive
      }
      cut_due_card_statements: {
        Args: Record<string, never>
        Returns: number
      }
      set_statement_reconciliation: {
        Args: {
          p_card_id: string
          p_period_year: number
          p_period_month: number
          p_bank_amount: number
          p_note?: string | null
        }
        Returns: CardStatementArchive
      }
      post_card_provision: {
        Args: {
          p_expense_id: string
          p_post_amount?: number
        }
        Returns: CardExpense
      }
      pay_card_debt: {
        Args: {
          p_card_id: string
          p_source_card_id: string
          p_amount: number
        }
        Returns: Card
      }
      recompute_card_debt_from_ledger: {
        Args: {
          p_card_id: string
        }
        Returns: number
      }
      post_card_debt_correction: {
        Args: {
          p_card_id: string
          p_amount_kurus: number
          p_note: string
        }
        Returns: number
      }
      recompute_account_balance_from_ledger: {
        Args: {
          p_card_id: string
        }
        Returns: number
      }
      post_account_balance_correction: {
        Args: {
          p_card_id: string
          p_amount_kurus: number
          p_note: string
        }
        Returns: number
      }
      pay_card_statement: {
        Args: {
          p_statement_id: string
          p_source_card_id: string
        }
        Returns: CardStatementArchive
      }
      pay_card_installment: {
        Args: {
          p_installment_id: string
          p_source_card_id: string
        }
        Returns: CardInstallment
      }
      unpay_card_installment: {
        Args: {
          p_installment_id: string
        }
        Returns: CardInstallment
      }
      transfer_between_accounts: {
        Args: {
          p_source_card_id: string
          p_target_card_id: string
          p_amount: number
          p_note?: string | null
        }
        Returns: Json
      }
      record_manual_account_movement: {
        Args: {
          p_card_id: string
          p_amount: number
          p_direction: 'in' | 'out'
          p_note?: string | null
        }
        Returns: Card
      }
      update_card_expense: {
        Args: {
          p_expense_id: string
          p_amount: number
          p_description: string
          p_spent_at?: string
          p_installment_count?: number
          p_category?: string
          p_note?: string | null
        }
        Returns: CardExpense
      }
      record_card_installment_carryover: {
        Args: {
          p_card_id: string
          p_description: string
          p_installment_amount: number
          p_total_installments: number
          p_paid_installments: number
          p_next_due_month: string
          p_category?: string
        }
        Returns: CardExpense
      }
      pay_loan_installment: {
        Args: {
          p_installment_id: string
          p_source_card_id: string
        }
        Returns: LoanInstallment
      }
      unpay_loan_installment: {
        Args: {
          p_installment_id: string
        }
        Returns: LoanInstallment
      }
      pay_payment: {
        Args: {
          p_payment_id: string
          p_source_card_id: string
          p_paid_amount?: number
        }
        Returns: Payment
      }
      pay_payment_from_card_import: {
        Args: {
          p_payment_id: string
          p_source_card_id: string
          p_paid_amount: number
          p_spent_at?: string
        }
        Returns: Payment
      }
      settle_personal_debt: {
        Args: {
          p_debt_id: string
          p_account_card_id: string
        }
        Returns: Debt
      }
      reset_user_finance_data: {
        Args: Record<string, never>
        Returns: void
      }
      reset_card_data: {
        Args: {
          p_card_id: string
        }
        Returns: void
      }
      post_due_card_auto_payments: {
        Args: Record<string, never>
        Returns: number
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type TableName = keyof Database['public']['Tables']
export type RowFor<T extends TableName> = Database['public']['Tables'][T]['Row']
export type InsertFor<T extends TableName> = Database['public']['Tables'][T]['Insert']
export type UpdateFor<T extends TableName> = Database['public']['Tables'][T]['Update']
