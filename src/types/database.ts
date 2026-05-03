export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type AssetCategory = 'Nakit' | 'Altın' | 'Fon' | 'Hisse' | 'Araç' | 'BES' | 'Diğer'
export type AssetUnit = 'TRY' | 'gram' | 'adet'
export type CardType = 'banka_karti' | 'kredi_karti'
export type LoanStatus = 'active' | 'closed'
export type DebtDirection = 'borç_aldım' | 'borç_verdim'
export type DebtValueType = 'TRY' | 'gram_altin' | 'ceyrek_altin'
export type DebtStatus = 'açık' | 'kapandı'
export type PaymentStatus = 'bekliyor' | 'ödendi'

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
  estimated_value_try: number
  note: string | null
}

export type Card = BaseRow & {
  bank_name: string
  card_name: string
  card_type: CardType
  current_balance: number
  credit_limit: number
  debt_amount: number
  statement_day: number | null
  due_day: number | null
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

export type Debt = BaseRow & {
  person_name: string
  direction: DebtDirection
  value_type: DebtValueType
  amount: number
  estimated_value_try: number
  due_date: string | null
  status: DebtStatus
  note: string | null
}

export type Payment = BaseRow & {
  title: string
  amount: number
  due_date: string
  status: PaymentStatus
  note: string | null
}

type Table<Row, Insert, Update> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

type WithBaseInsert<T> = Omit<T, keyof BaseRow> & {
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
      loans: Table<Loan, WithBaseInsert<Loan>, WithBaseUpdate<Loan>>
      debts: Table<Debt, WithBaseInsert<Debt>, WithBaseUpdate<Debt>>
      payments: Table<Payment, WithBaseInsert<Payment>, WithBaseUpdate<Payment>>
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type TableName = keyof Database['public']['Tables']
export type RowFor<T extends TableName> = Database['public']['Tables'][T]['Row']
export type InsertFor<T extends TableName> = Database['public']['Tables'][T]['Insert']
export type UpdateFor<T extends TableName> = Database['public']['Tables'][T]['Update']
