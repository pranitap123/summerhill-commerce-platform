export function NotAuthorised() {
  return (
    <div role="alert">
      <h1 className="font-display text-3xl text-[#1F3A2E] mb-2">403: not authorised</h1>
      <p>Your account doesn&apos;t have access to the operations console.</p>
    </div>
  )
}
