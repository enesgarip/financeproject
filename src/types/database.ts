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
export type CardExpenseSource =
  | 'manual'
  | 'sms'
  | 'statement_import'
  | 'movement_import'
  | 'receipt_scan'
  | 'payment_auto'
  | 'carryover'
export type CardStatementStatus = 'open' | 'paid'
export type SavingsGoalStatus = 'active' | 'completed'
export type SavingsGoalValueType = 'TRY' | 'gram_altin' | 'ceyrek_altin' | 'composite'
/** Hedef tutarının çıpası: sabit TL, altın/dolar endeksli ya da aylık gider katı. */
export type SavingsGoalTargetAnchor = 'manual' | 'gold' | 'usd' | 'expense_months'
export type TransactionHistoryType = 'payment' | 'transfer' | 'loan' | 'debt' | 'card' | 'correction' | 'asset'
export type UpcomingDismissalSource = 'payment' | 'card' | 'loan_installment' | 'debt'
export type ExpenseContextKind = 'pet' | 'project' | 'travel' | 'health' | 'hobby' | 'business'

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
  /** Otomatik değerlemenin yaşı (Faz D3). NULL = elle girilmiş ya da eski kayıt. */
  valued_at: string | null
  /** Hesapta kullanılan birim TL fiyatı; `amount` sonradan değişince geri hesaplanamaz. */
  valuation_rate: number | null
  /** When 'gold_ledger', this row is an aggregate maintained from gold_lots (do not hand-edit). */
  source: string | null
  note: string | null
}

export type GoldType = 'gram' | 'ceyrek'
export type GoldDirection = 'buy' | 'sell'

export type GoldLot = BaseRow & {
  /** Purchase date; null when unknown. */
  purchase_date: string | null
  gold_type: GoldType
  /** Karat (e.g. 24, 22); informational. */
  ayar: number | null
  quantity: number
  /** TRY paid per unit at purchase (buy) or received per unit (sell); null when unknown. */
  unit_price: number | null
  direction: GoldDirection
  note: string | null
}

export type Card = BaseRow & {
  bank_name: string
  card_name: string
  card_type: CardType
  holder_name: string | null
  account_number: string | null
  iban?: string | null
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

export type CardAlias = BaseRow & {
  card_id: string
  last_four_digits: string
  label: string | null
}

export type SmsLogType = 'card_expense' | 'account_movement' | 'unrecognized'
export type SmsLogStatus = 'success' | 'error'

export type SmsLog = {
  id: string
  user_id: string | null
  created_at: string
  sms_type: SmsLogType
  status: SmsLogStatus
  summary: string | null
  amount: number | null
  error_message: string | null
  raw_sms: string
}

export type CardExpense = BaseRow & {
  card_id: string
  statement_archive_id: string | null
  current_settlement_id?: string | null
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
  /** Kaydın nereden geldiği (otomasyon kapsamı ölçümü). NULL = eski kayıt. */
  source: CardExpenseSource | null
  /** Kaynak sistemdeki mantıksal olay; retry tekilleştirmesi için kullanılır. */
  source_event_id?: string | null
  /** Bu harcamayı bir araca etiketler (Arabalarım). Saf annotation; borca dokunmaz. */
  car_id?: string | null
  fuel_liters?: number | null
  odometer_km?: number | null
  context_id?: string | null
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
  /** Otomatik değerlemenin yaşı (Faz D3). NULL = elle girilmiş ya da eski kayıt. */
  valued_at: string | null
  /** Hesapta kullanılan birim TL fiyatı. */
  valuation_rate: number | null
  target_date: string | null
  status: SavingsGoalStatus
  note: string | null
  /**
   * Hedef TUTARININ neye bağlı olduğu. 'manual' dışında `target_amount` DB'de
   * 0'dır ve tutar okuma anında türetilir (bkz. utils/goalTargetAnchor.ts).
   */
  target_anchor: SavingsGoalTargetAnchor
  /** gold/usd çıpasında hedefin birim büyüklüğü (gram ya da USD). */
  target_anchor_units: number | null
  /** expense_months çıpasında kaç aylık gider. */
  target_anchor_months: number | null
}

export type SavingsGoalComponent = BaseRow & {
  goal_id: string
  label: string | null
  value_type: Exclude<SavingsGoalValueType, 'composite'>
  target_amount: number
  current_amount: number
  sort_order: number
}

export type SavingsGoalSourceKind = 'asset' | 'asset_category' | 'all_assets' | 'bank_account' | 'kasa_bucket'

/**
 * Hedefin (ya da karma hedefin bir bileşeninin) biriken tutarını nereden takip
 * ettiği. Kaynak bağlıysa `current_amount` elle girilmez ve saklanmaz; okuma
 * anında kaynaklardan türetilir (bkz. utils/goalSources.ts).
 */
export type SavingsGoalSource = BaseRow & {
  goal_id: string
  /** NULL = hedefin kendisi; dolu = karma hedefin tek bir bileşeni. */
  component_id: string | null
  kind: SavingsGoalSourceKind
  asset_id: string | null
  asset_category: AssetCategory | null
  /** Banka hesabı (cards.card_type = 'banka_karti'). */
  card_id: string | null
  bucket_id: string | null
  sort_order: number
}

export type CardInstallment = BaseRow & {
  card_id: string
  card_expense_id: string | null
  statement_archive_id: string | null
  current_settlement_id?: string | null
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

export type CardInstallmentIntentStatus = 'active' | 'consumed' | 'cancelled'

/**
 * Alışverişten önce bırakılan "bu işlem N taksit olacak" notu. SMS provizyonu
 * düştüğü anda `record_sms_card_expense` içinden uygulanır (yalnız etiket yazar;
 * borç/kova/ledger'a dokunmaz). Bkz. docs/CARD_DEBT_TRANSITIONS.md.
 */
export type CardInstallmentIntent = BaseRow & {
  /** NULL = kullanıcının herhangi bir kredi kartı. */
  card_id: string | null
  merchant_hint: string | null
  min_amount: number | null
  max_amount: number | null
  installment_count: number
  expires_at: string
  status: CardInstallmentIntentStatus
  consumed_expense_id: string | null
  consumed_at: string | null
  note: string | null
}

export type CardCurrentSettlement = BaseRow & {
  card_id: string
  source_card_id: string | null
  amount: number
  settled_at: string
  note: string | null
  settlement_kind: 'payment' | 'historical_repair'
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

/**
 * Kısmi/asgari ekstre ödemesi (K7, migration 20260812110000). Append-only:
 * arşiv tutarı hiç değişmez, ödemeler bu çocuk tabloya yazılır ve
 * kalan(arşiv) = arşiv.statement_debt_amount − sum(ödemeler). Tam ödeme
 * (p_amount null ya da kalana eşit) arşivi `paid` yapar; kısmi ödeme açık
 * bırakır. `source_debited=false` = bakiye banka/SMS tarafından zaten
 * düşülmüştü (B4 yolu). updated_at yok — satırlar değiştirilemez.
 */
export type CardStatementPayment = {
  id: string
  user_id: string
  card_id: string
  statement_archive_id: string
  source_card_id: string | null
  amount: number
  paid_at: string
  source_debited: boolean
  note: string | null
  created_at: string
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
  /** Otomatik değerlemenin yaşı (Faz D3). NULL = elle girilmiş ya da eski kayıt. */
  valued_at: string | null
  /** Hesapta kullanılan birim TL fiyatı (borçta Satış tarafı). */
  valuation_rate: number | null
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
  source_event_id: string | null
  note: string | null
}

export type CardLedgerKind = 'opening' | 'debit' | 'credit' | 'adjustment' | 'reclass'

/**
 * Append-only event log of credit-card debt changes (roadmap A2). Each row is
 * one change captured atomically by a trigger on `cards`. `amount_kurus` is
 * signed integer kuruş: +debit (debt up), -credit (debt down). The card's debt
 * equals the sum of its events (see utils/cardLedger.ts).
 *
 * Bucket deltas track which breakdown bucket each change affected. Pre-migration
 * events have null deltas; new events always populate them. `reclass` events
 * capture zero-debt-delta bucket shifts (e.g. statement cut).
 */
export type CardLedger = BaseRow & {
  card_id: string
  occurred_at: string
  kind: CardLedgerKind
  amount_kurus: number
  statement_delta_kurus: number | null
  current_delta_kurus: number | null
  provision_delta_kurus: number | null
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

export type DataHealthRepairRunStatus = 'running' | 'succeeded' | 'conflict' | 'failed'
export type DataHealthRepairStepStatus = 'applied' | 'skipped' | 'conflict' | 'failed'

/** Immutable receipt for one transactional Data Health safe-repair batch. */
export type DataHealthRepairRun = {
  id: string
  user_id: string
  idempotency_key: string
  request_plan: Json
  status: DataHealthRepairRunStatus
  planned_count: number
  applied_count: number
  skipped_count: number
  failure_reason: string | null
  created_at: string
  completed_at: string | null
}

/** Per-target before/after evidence owned by a Data Health repair run. */
export type DataHealthRepairStep = {
  id: string
  run_id: string
  user_id: string
  rule: string
  target_table: string
  target_id: string | null
  status: DataHealthRepairStepStatus
  before_data: Json | null
  after_data: Json | null
  message: string | null
  created_at: string
}

/** Reversible per-user acceptance of one deterministic Data Health issue ID. */
export type DataHealthIssueAcknowledgement = {
  id: string
  user_id: string
  issue_id: string
  acknowledged_at: string
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
 * Ölçümden sonra ne olduğu (Faz D1). `drift` ham gözlemi tutar, bu kolon
 * gözlemin akıbetini: fark yoktu / duruyor / ledger düzeltmesiyle kapatıldı.
 * NULL = kolon eklenmeden önce yazılmış kayıt, akıbeti bilinmiyor.
 */
export type ReconciliationResolution = 'matched' | 'open' | 'corrected'

/**
 * One live-balance reconciliation event (roadmap A3): a snapshot comparing the
 * app's current figure (bank account current_balance or credit-card
 * debt_amount) against the real figure the user read in their banking app.
 * `drift` = app_amount - real_amount, stored as a point-in-time fact — düzeltme
 * uygulansa bile DEĞİŞMEZ (DB'de check kısıtıyla zorlanır).
 */
export type AccountReconciliation = BaseRow & {
  card_id: string
  reconciled_at: string
  target: ReconciliationTarget
  app_amount: number
  real_amount: number
  drift: number
  resolution: ReconciliationResolution | null
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

export type WishlistItem = BaseRow & {
  name: string
  estimated_price: number | null
  is_purchased: boolean
  purchased_at: string | null
  sort_order: number
  note: string | null
}

export type KasaBucket = BaseRow & {
  name: string
  reserved_amount: number
  sort_order: number
  note: string | null
  /** Bu kova bir birikim hedefine ayrılmışsa hedefin kimliği (en fazla bir kova). */
  goal_id: string | null
  /** Hedef planına göre en son ayırma yapılan ayın ilk günü; NULL = hiç ayrılmadı. */
  last_contribution_month: string | null
}

export type Car = BaseRow & {
  name: string
  plate: string | null
  current_odometer_km: number | null
  sort_order: number
  note: string | null
}

/** Kart-dışı araç gideri ödeme yöntemi (kart giderleri card_expenses'te kalır). */
export type CarPaymentMethod = 'nakit' | 'banka' | 'diger'

/**
 * Kart-dışı (nakit/banka) manuel araç gideri. Kartla yapılan giderler buraya
 * GİRMEZ; onlar card_expenses + car_id etiketiyle izlenir. Bu satırlar net
 * değer/nakit akışı matematiğine katılmaz — yalnız Arabalarım raporlaması.
 */
export type CarExpense = BaseRow & {
  car_id: string
  spent_at: string
  amount: number
  category: string
  payment_method: CarPaymentMethod
  description: string
  note: string | null
  fuel_liters: number | null
  odometer_km: number | null
}

export type CarReminderKind = 'bakim' | 'mtv' | 'muayene' | 'sigorta' | 'kasko' | 'lastik' | 'diger'

export type CarReminder = BaseRow & {
  car_id: string
  title: string
  kind: CarReminderKind
  due_date: string | null
  due_odometer_km: number | null
  repeat_months: number | null
  repeat_km: number | null
  note: string | null
}

export type ExpenseContext = BaseRow & {
  kind: ExpenseContextKind
  name: string
  budget_amount: number | null
  starts_on: string | null
  ends_on: string | null
  sort_order: number
  note: string | null
}

export type ContextExpense = BaseRow & {
  context_id: string
  spent_at: string
  amount: number
  category: string
  payment_method: CarPaymentMethod
  description: string
  note: string | null
}

// user_id birincil anahtar (kullanıcı başına tek satır); BaseRow'daki id yok.
export type NotificationPreferences = {
  user_id: string
  created_at: string
  updated_at: string
  payments_enabled: boolean
  loans_enabled: boolean
  statements_enabled: boolean
  weekly_enabled: boolean
  cars_enabled: boolean
  provisions_enabled: boolean
  /** Hedefe bağlı kovaya bu ay ayırma yapılmadıysa ay başında hatırlat. */
  goals_enabled: boolean
  quiet_hours_start: number | null
  quiet_hours_end: number | null
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

/**
 * fetch_finance_snapshot RPC'sinin tek JSON yükü. Anahtarlar tablo adlarıdır;
 * pencere/sıralama semantiği financeSnapshotRepo'daki legacy sorgularla birebir
 * aynıdır. `missing_tables` = migration bekleyen ortamda eksik opsiyonel tablolar
 * (optionalRows ikizi — RPC bunları hata değil boş liste + kayıt olarak döndürür).
 */
export type FinanceSnapshotRpcPayload = {
  assets: Asset[]
  cards: Card[]
  loans: Loan[]
  loan_installments: LoanInstallment[]
  debts: Debt[]
  payments: Payment[]
  salary_history: SalaryHistory[]
  transaction_history: TransactionHistory[]
  budgets: Budget[]
  card_expenses: CardExpense[]
  card_installments: CardInstallment[]
  card_statement_archives: CardStatementArchive[]
  card_statement_payments: CardStatementPayment[]
  savings_goals: SavingsGoal[]
  savings_goal_components: SavingsGoalComponent[]
  savings_goal_sources: SavingsGoalSource[]
  account_reconciliations: AccountReconciliation[]
  missing_tables: string[]
}

export type Database = {
  public: {
    Tables: {
      assets: Table<Asset, WithBaseInsert<Asset>, WithBaseUpdate<Asset>>
      cards: Table<Card, WithBaseInsert<Card>, WithBaseUpdate<Card>>
      card_aliases: Table<CardAlias, WithBaseInsert<CardAlias>, WithBaseUpdate<CardAlias>>
      card_expenses: Table<CardExpense, WithBaseInsert<CardExpense>, WithBaseUpdate<CardExpense>>
      card_current_settlements: Table<
        CardCurrentSettlement,
        WithBaseInsert<CardCurrentSettlement>,
        WithBaseUpdate<CardCurrentSettlement>
      >
      budgets: Table<Budget, WithBaseInsert<Budget>, WithBaseUpdate<Budget>>
      savings_goals: Table<SavingsGoal, WithBaseInsert<SavingsGoal>, WithBaseUpdate<SavingsGoal>>
      savings_goal_components: Table<SavingsGoalComponent, WithBaseInsert<SavingsGoalComponent>, WithBaseUpdate<SavingsGoalComponent>>
      savings_goal_sources: Table<SavingsGoalSource, WithBaseInsert<SavingsGoalSource>, WithBaseUpdate<SavingsGoalSource>>
      card_installments: Table<CardInstallment, WithBaseInsert<CardInstallment>, WithBaseUpdate<CardInstallment>>
      card_installment_intents: Table<
        CardInstallmentIntent,
        WithBaseInsert<CardInstallmentIntent>,
        WithBaseUpdate<CardInstallmentIntent>
      >
      card_statement_archives: Table<CardStatementArchive, WithBaseInsert<CardStatementArchive>, WithBaseUpdate<CardStatementArchive>>
      // Append-only: update/delete guard'lıdır; Insert yalnız backup restore için.
      card_statement_payments: Table<
        CardStatementPayment,
        Omit<CardStatementPayment, 'id' | 'created_at' | 'paid_at' | 'source_card_id' | 'source_debited' | 'note'> & {
          id?: string
          created_at?: string
          paid_at?: string
          source_card_id?: string | null
          source_debited?: boolean
          note?: string | null
        },
        Partial<Omit<CardStatementPayment, 'id' | 'user_id' | 'created_at'>>
      >
      loans: Table<Loan, WithBaseInsert<Loan>, WithBaseUpdate<Loan>>
      loan_installments: Table<LoanInstallment, WithBaseInsert<LoanInstallment>, WithBaseUpdate<LoanInstallment>>
      debts: Table<Debt, WithBaseInsert<Debt>, WithBaseUpdate<Debt>>
      payments: Table<Payment, WithBaseInsert<Payment>, WithBaseUpdate<Payment>>
      transaction_history: Table<TransactionHistory, WithBaseInsert<TransactionHistory>, WithBaseUpdate<TransactionHistory>>
      wishlist_items: Table<WishlistItem, WithBaseInsert<WishlistItem>, WithBaseUpdate<WishlistItem>>
      kasa_buckets: Table<KasaBucket, WithBaseInsert<KasaBucket>, WithBaseUpdate<KasaBucket>>
      cars: Table<Car, WithBaseInsert<Car>, WithBaseUpdate<Car>>
      car_expenses: Table<CarExpense, WithBaseInsert<CarExpense>, WithBaseUpdate<CarExpense>>
      car_reminders: Table<CarReminder, WithBaseInsert<CarReminder>, WithBaseUpdate<CarReminder>>
      expense_contexts: Table<ExpenseContext, WithBaseInsert<ExpenseContext>, WithBaseUpdate<ExpenseContext>>
      context_expenses: Table<ContextExpense, WithBaseInsert<ContextExpense>, WithBaseUpdate<ContextExpense>>
      notification_preferences: Table<
        NotificationPreferences,
        WithBaseInsert<NotificationPreferences>,
        WithBaseUpdate<NotificationPreferences>
      >
      salary_history: Table<SalaryHistory, WithBaseInsert<SalaryHistory>, WithBaseUpdate<SalaryHistory>>
      net_worth_snapshots: Table<NetWorthSnapshot, WithBaseInsert<NetWorthSnapshot>, WithBaseUpdate<NetWorthSnapshot>>
      gold_lots: Table<GoldLot, WithBaseInsert<GoldLot>, WithBaseUpdate<GoldLot>>
      card_ledger: Table<CardLedger, WithBaseInsert<CardLedger>, WithBaseUpdate<CardLedger>>
      account_ledger: Table<AccountLedger, WithBaseInsert<AccountLedger>, WithBaseUpdate<AccountLedger>>
      data_health_repair_runs: Table<
        DataHealthRepairRun,
        Omit<DataHealthRepairRun, 'id' | 'created_at' | 'completed_at' | 'failure_reason'> & {
          id?: string
          created_at?: string
          completed_at?: string | null
          failure_reason?: string | null
        },
        Partial<Omit<DataHealthRepairRun, 'id' | 'user_id' | 'created_at'>>
      >
      data_health_repair_steps: Table<
        DataHealthRepairStep,
        Omit<DataHealthRepairStep, 'id' | 'created_at' | 'target_id' | 'before_data' | 'after_data' | 'message'> & {
          id?: string
          created_at?: string
          target_id?: string | null
          before_data?: Json | null
          after_data?: Json | null
          message?: string | null
        },
        Partial<Omit<DataHealthRepairStep, 'id' | 'run_id' | 'user_id' | 'created_at'>>
      >
      data_health_issue_acknowledgements: Table<
        DataHealthIssueAcknowledgement,
        Omit<DataHealthIssueAcknowledgement, 'id' | 'acknowledged_at'> & {
          id?: string
          acknowledged_at?: string
        },
        Partial<Omit<DataHealthIssueAcknowledgement, 'id' | 'user_id'>>
      >
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
      sms_log: Table<
        SmsLog,
        Omit<SmsLog, 'id' | 'created_at'> & { id?: string; created_at?: string },
        Partial<Omit<SmsLog, 'id'>>
      >
      dismissed_upcoming_items: Table<
        DismissedUpcomingItem,
        Omit<DismissedUpcomingItem, 'id' | 'created_at'> & { id?: string; created_at?: string },
        Partial<Omit<DismissedUpcomingItem, 'id' | 'user_id' | 'created_at'>> & { created_at?: string }
      >
    }
    Views: Record<string, never>
    Functions: {
      fetch_finance_snapshot: {
        Args: {
          /** snapshotWindowStart().toISOString() — transaction_history penceresi. */
          p_window_start: string
          /** dateInputValue(snapshotWindowStart()) — budgets/card_expenses penceresi. */
          p_window_start_date: string
          /** STATEMENT_ARCHIVE_LIMIT (card_statement_archives). */
          p_statement_limit?: number
        }
        Returns: FinanceSnapshotRpcPayload
      }
      add_card_expense: {
        Args: {
          p_card_id: string
          p_amount: number
          p_description: string
          p_spent_at?: string
          p_installment_count?: number
          p_category?: string
          p_status?: CardExpenseStatus
          p_source?: CardExpenseSource
          p_source_event_id?: string | null
        }
        Returns: CardExpense
      }
      apply_card_installment_intent: {
        Args: { p_expense_id: string }
        Returns: CardExpense
      }
      record_sms_card_expense: {
        Args: {
          p_card_id: string
          p_amount: number
          p_description: string
          p_spent_at: string
          p_category: string
          p_user_id: string
          p_source_event_id: string
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
          // PDF importunda banka belgesi tarih otoritesidir (±7 gün pencere);
          // verilmezse kartın kesim/vade takviminden türetilir.
          p_statement_date?: string | null
          p_due_date?: string | null
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
          // true → bakiye SMS/banka hareketiyle zaten düşülmüş; tekrar düşülmez.
          p_skip_source_debit?: boolean
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
      reconcile_card_bank_snapshot: {
        Args: {
          p_bank_total_kurus: number
          p_card_id: string
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
          // true → bakiye SMS/banka hareketiyle zaten düşülmüş; tekrar düşülmez.
          p_skip_source_debit?: boolean
          // verilmezse/null → kalanın tamamı; kalandan az → kısmi ödeme (arşiv açık kalır).
          p_amount?: number
        }
        Returns: CardStatementArchive
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
      trade_asset_with_account: {
        Args: {
          p_asset_id: string
          p_account_card_id: string
          p_direction: 'buy' | 'sell'
          p_amount: number
          p_quantity?: number | null
          p_note?: string | null
        }
        Returns: Asset
      }
      contribute_to_goal_bucket: {
        Args: {
          p_bucket_id: string
          p_amount: number
        }
        /** Ayırma sonrası kovadaki toplam rezerv. */
        Returns: number
      }
      upsert_savings_goal: {
        Args: {
          p_goal_id?: string | null
          p_name?: string | null
          p_value_type?: string
          p_target_amount?: number
          p_current_amount?: number
          p_estimated_value_try?: number | null
          p_auto_valued?: boolean
          p_target_date?: string | null
          p_status?: string
          p_note?: string | null
          p_is_composite?: boolean
          p_components?: Json
          p_sources?: Json
          p_target_anchor?: string
          p_target_anchor_units?: number | null
          p_target_anchor_months?: number | null
        }
        Returns: string
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
          p_source_event_id?: string | null
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
          p_source_event_id?: string
          p_source: Extract<CardExpenseSource, 'statement_import' | 'movement_import'>
        }
        Returns: Payment
      }
      settle_personal_debt: {
        Args: {
          p_debt_id: string
          p_account_card_id: string
          // null/tam değer → kapatır; daha az → kısmi ödeme (kayıt açık kalır).
          p_amount?: number | null
        }
        Returns: Debt
      }
      reset_user_finance_data: {
        Args: Record<string, never>
        Returns: void
      }
      acknowledge_data_health_issues: {
        Args: {
          p_issue_ids: string[]
        }
        Returns: void
      }
      clear_data_health_issue_acknowledgements: {
        Args: Record<string, never>
        Returns: void
      }
      apply_data_health_safe_repairs: {
        Args: {
          p_repairs: Json
          p_idempotency_key: string
        }
        Returns: Json
      }
      update_card_expense_health_metadata: {
        Args: {
          p_expense_id: string
          p_description: string
          p_category: string
          p_expected_updated_at: string
        }
        Returns: CardExpense
      }
      reset_card_import_data: {
        Args: {
          p_card_id: string
        }
        Returns: void
      }
      replace_card_statement_import: {
        Args: {
          p_card_id: string
          p_statement_date: string
          p_due_date: string | null
          p_bank_amount: number
          p_actions: Json
        }
        Returns: Json
      }
      post_due_card_installments: {
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
// CrudPage yalnız `id` birincil anahtarlı tablolarla çalışır; user_id-PK tablolar
// (notification_preferences gibi) generic CRUD kabuğuna girmez.
export type CrudTableName = { [K in TableName]: 'id' extends keyof RowFor<K> ? K : never }[TableName]
export type InsertFor<T extends TableName> = Database['public']['Tables'][T]['Insert']
export type UpdateFor<T extends TableName> = Database['public']['Tables'][T]['Update']
