import { Plugin } from '@opencode/plugin';
import { installOpenCodeAuth } from '../opencode-auth.mjs';

export default Plugin.define({
  id: 'machinal.auth',
  setup: installOpenCodeAuth,
});
