import { addMonths, dateInputValue } from './date'
import { roundTL } from './money'

export type ImportedInstallmentPlan = {
  originalDate: string
  currentInstallmentDate: string
  installmentNo: number
  totalInstallments: number
  paidInstallments: number
  remainingInstallments: number
  totalAmount: number
  remainingAmount: number
}

export function buildImportedInstallmentPlan(input: {
  originalDate: string
  installmentNo: number
  totalInstallments: number
  installmentAmount: number
}): ImportedInstallmentPlan {
  const totalInstallments = Math.max(2, Math.trunc(input.totalInstallments))
  const installmentNo = Math.min(totalInstallments, Math.max(1, Math.trunc(input.installmentNo)))
  const paidInstallments = installmentNo - 1
  const remainingInstallments = totalInstallments - paidInstallments
  const originalDate = input.originalDate.slice(0, 10)
  const currentInstallmentDate = dateInputValue(
    addMonths(new Date(`${originalDate}T00:00:00`), paidInstallments),
  )

  return {
    originalDate,
    currentInstallmentDate,
    installmentNo,
    totalInstallments,
    paidInstallments,
    remainingInstallments,
    totalAmount: roundTL(input.installmentAmount * totalInstallments),
    remainingAmount: roundTL(input.installmentAmount * remainingInstallments),
  }
}
