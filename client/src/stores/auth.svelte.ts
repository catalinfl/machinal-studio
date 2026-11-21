// Editor integrations still consume this access facade. It represents the
// single local workspace, not a signed-in account or a subscription.
export const auth = {
  user: { id: 'local', name: 'Local workspace', email: '', avatar: '' },
  isLogged: true,
  isPaid: true,
  token: '',
  busy: false,
  error: '',
}

export async function initAuth(): Promise<void> {}
