type NavigationIcon = 'layers' | 'play' | 'code' | 'terminal' | 'network' | 'file' | 'direction'
export type ProductLink = { label: string; href: string; description?: string; icon?: NavigationIcon }

export const PRODUCT_LINKS: ProductLink[] = [
  { label: 'Toolkit', href: '/toolkit', description: 'Explore styles, effects and transitions.', icon: 'layers' },
  { label: 'Features', href: '/#features', description: 'Timeline, effects, titles and audio.', icon: 'play' },
  { label: 'Svelte scenes', href: '/#scenes', description: 'Animated scenes and transparent overlays.', icon: 'code' },
  { label: 'Run locally', href: '/docs#local-headless', description: 'Your machine. Docker or the edit CLI.', icon: 'terminal' },
]

export const DEVELOPER_LINKS: ProductLink[] = [
  { label: 'API', href: '/api', description: 'Bring video into your apps and workflows.', icon: 'code' },
  { label: 'MCP', href: '/mcp', description: 'Connect your coding agent to machinal.', icon: 'network' },
]

export const RESOURCE_LINKS: ProductLink[] = [
  { label: 'Documentation', href: '/docs', description: 'Guides, recipes and API reference.', icon: 'file' },
  { label: 'About', href: '/about', description: 'A closer look at machinal.', icon: 'direction' },
  { label: 'GitHub', href: 'https://github.com/catalinfl/viral-server', description: 'Source code and self-hosting setup.', icon: 'code' },
]

export const WORKSPACE_LINKS: ProductLink[] = [
  { label: 'Membership & billing', href: '/membership' },
  { label: 'Jobs & downloads', href: '/jobs' },
  { label: 'API keys & credits', href: '/api-keys' },
  { label: 'Account', href: '/account' },
]
