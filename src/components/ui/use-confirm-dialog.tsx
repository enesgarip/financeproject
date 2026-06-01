import { useCallback, useState } from "react"

import { ConfirmDialog } from "@/components/ui/confirm-dialog"

type ConfirmOptions = {
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: "destructive" | "default"
}

type ConfirmRequest = ConfirmOptions & {
  resolve: (value: boolean) => void
}

function useConfirmDialog() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setRequest({ ...options, resolve })
    })
  }, [])

  function close(value: boolean) {
    request?.resolve(value)
    setRequest(null)
  }

  const confirmDialog = (
    <ConfirmDialog
      open={Boolean(request)}
      title={request?.title ?? ""}
      description={request?.description ?? ""}
      confirmLabel={request?.confirmLabel}
      cancelLabel={request?.cancelLabel}
      variant={request?.variant}
      onCancel={() => close(false)}
      onConfirm={() => close(true)}
    />
  )

  return { confirm, confirmDialog }
}

export { useConfirmDialog }
