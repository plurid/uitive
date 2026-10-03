export interface ManifestOptions {
  /** Development builds also match a local origin, such as the test fixture's. */
  origins?: readonly string[];
}

/** A match pattern for an origin; ports are left out, since match patterns cover them all. */
export const pattern = (origin: string) => {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
};

/**
 * Nothing site-specific is granted at install: each site is enabled from the side panel, one
 * origin at a time, and its content script registered then. No web-accessible resources.
 */
export const manifest = (options: ManifestOptions = {}) => ({
  manifest_version: 3,
  name: 'Aptuitive',
  version: '0.1.0',
  description:
    'Reshape the work apps you use by asking, within what each app allows. A private prototype.',
  minimum_chrome_version: '116',
  action: { default_title: 'Aptuitive' },
  side_panel: { default_path: 'panel/index.html' },
  background: { service_worker: 'worker.js', type: 'module' },
  permissions: ['storage', 'sidePanel', 'scripting', 'activeTab'],
  optional_host_permissions: ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'],
  ...(options.origins && options.origins.length > 0
    ? { host_permissions: [...new Set(options.origins.map(pattern))] }
    : {}),
});
