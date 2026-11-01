// Seed sessions for iter44 testing
use('test_database');
var out = {};
function mint(email, label) {
  var u = db.users.findOne({ email: email });
  if (!u) { out[label] = 'MISSING_USER'; return; }
  var tok = 'test_iter44_' + label + '_' + Date.now();
  db.user_sessions.insertOne({
    user_id: u.user_id, session_token: tok,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    created_at: new Date()
  });
  out[label] = { token: tok, user_id: u.user_id, account_type: u.account_type };
}
mint('pro.marina@sailmorenow.dev', 'pro');
mint('captain.jane@sailmorenow.dev', 'owner');

// New onboarding user named 'Test Sailor', onboarding_complete=false
var nuid = 'iter44-new-' + Date.now();
var ntok = 'test_iter44_new_' + Date.now();
db.users.insertOne({
  user_id: nuid, email: 'test.sailor.iter44@sailmorenow.dev', name: 'Test Sailor',
  picture: 'https://via.placeholder.com/150', account_type: 'sailor',
  onboarding_complete: false, subscription_tier: 'free', created_at: new Date()
});
db.user_sessions.insertOne({
  user_id: nuid, session_token: ntok,
  expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), created_at: new Date()
});
out['newuser'] = { token: ntok, user_id: nuid };
out['captainjane_handle'] = (db.users.findOne({ handle: 'captainjane' }) || {}).name || 'NO_captainjane_HANDLE';
print(JSON.stringify(out, null, 1));
