import assert from 'node:assert/strict';
import test from 'node:test';
import { accountNameChange, accountProfileHref, accountSection } from '../src/lib/account-profile';
import { accountReturnTitle } from '../src/auth/account-return';

test('profile sections keep the original return destination bounded and have useful back labels', () => {
  const root = '/more/account?from=%2Fareas%2Fin-out%2Fvisits%3Fview%3Dpast';
  assert.equal(accountProfileHref('details', root), '/more/account/details?from=%2Fareas%2Fin-out%2Fvisits%3Fview%3Dpast');
  assert.equal(accountProfileHref('profile', accountProfileHref('details', root)), root);
  for (const target of ['https://other.invalid', '//other.invalid', '/more/account?from=/more/account']) assert.equal(accountProfileHref('appearance', '/more/account?from='+encodeURIComponent(target)), '/more/account/appearance');
  assert.equal(accountSection('/more/account/details?from=/work'), 'details');
  assert.equal(accountSection('/more/account/constructor'), 'profile');
  assert.equal(accountReturnTitle('/more/account/details?from=/work'), 'Personal details');
  assert.equal(accountReturnTitle('/more/account/assistant'), 'Assistant preferences');
});
test('editing one name preserves spelling, internal spaces and exact legacy concurrency expectations', () => {
  assert.deepEqual(accountNameChange('  श्रुति  नायर ', { first_name: 'Old ', last_name: ' Name' }), { first_name: 'श्रुति  नायर', last_name: '', expected_first_name: 'Old ', expected_last_name: ' Name' });
  for (const value of ['', ' ', 'Name\nOther', 'a'.repeat(151)]) assert.throws(() => accountNameChange(value,{first_name:'One',last_name:''}));
});
