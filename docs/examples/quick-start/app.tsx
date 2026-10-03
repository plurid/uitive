import { AptBanner, AptuitiveProvider, AptYourInterface } from '@plurid/aptuitive-react';
import { Ask } from './ask.js';
import { aptuitive } from './client.js';
import { Toolbar } from './toolbar.js';

export function Editor({ run }: { run(action: string): void }) {
  return (
    <AptuitiveProvider client={aptuitive}>
      <Toolbar run={run} />
      <Ask />
      {/* What just changed and why, with Revert and Keep; and every change, owned by the person. */}
      <AptBanner client={aptuitive} />
      <AptYourInterface client={aptuitive} />
    </AptuitiveProvider>
  );
}
