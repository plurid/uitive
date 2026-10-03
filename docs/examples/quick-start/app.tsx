import { UitiveBanner, UitiveProvider, UitiveYourInterface } from '@plurid/uitive-react';
import { Ask } from './ask.js';
import { uitive } from './client.js';
import { Toolbar } from './toolbar.js';

export function Editor({ run }: { run(action: string): void }) {
  return (
    <UitiveProvider client={uitive}>
      <Toolbar run={run} />
      <Ask />
      {/* What just changed and why, with Revert and Keep; and every change, owned by the person. */}
      <UitiveBanner client={uitive} />
      <UitiveYourInterface client={uitive} />
    </UitiveProvider>
  );
}
