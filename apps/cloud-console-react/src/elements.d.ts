import type { Persona } from '@plurid/aptuitive-core';
import type { ClientLike } from '@plurid/aptuitive-dom';
import type { DetailedHTMLProps, HTMLAttributes } from 'react';

type Element<Properties> = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & Properties;

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'apt-banner': Element<{ client?: ClientLike }>;
      'apt-your-interface': Element<{ client?: ClientLike }>;
      'apt-debug': Element<{ client?: ClientLike; personas?: readonly Persona[] }>;
    }
  }
}
