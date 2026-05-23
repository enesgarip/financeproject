export const expenseCategories = [
  'Market',
  'Yemek',
  'Ulaşım',
  'Alışveriş',
  'Fatura',
  'Sağlık',
  'Eğlence',
  'Eğitim',
  'Diğer',
]

export const expenseCategoryOptions = expenseCategories.map((category) => ({
  label: category,
  value: category,
}))
