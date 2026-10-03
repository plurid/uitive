import { humanise } from '@plurid/aptuitive-core';
import { createKit, defaultKit } from '@plurid/aptuitive-react';

const STATES = new Set(['running', 'stopped', 'updating', 'critical', 'warning', 'error', 'info']);

/** Aptuitive's generic blocks, drawn in the console's own style. */
export const consoleKit = createKit({
  Value: (props) => {
    const { field, value } = props;
    if ((field.name === 'cpu' || field.name === 'memory') && typeof value === 'number') {
      return (
        <span className="meter" title={`${value}%`}>
          <span style={{ width: `${value}%` }} className={value > 85 ? 'hot' : undefined} />
          <span className="meter-text">{value}%</span>
        </span>
      );
    }
    if (field.type === 'enum' && typeof value === 'string' && STATES.has(value)) {
      return <span className={`state ${value}`}>{humanise(value)}</span>;
    }
    if (field.name === 'id' && typeof value === 'string')
      return <span className="mono">{value}</span>;
    return <defaultKit.Value {...props} />;
  },
});
