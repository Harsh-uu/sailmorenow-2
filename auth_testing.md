# Auth-Gated App Testing Playbook — Sail More Now

## Step 1: Create Test User & Session

```bash
mongosh --eval "
use('test_database');
var userId = 'test-user-' + Date.now();
var sessionToken = 'test_session_' + Date.now();
db.users.insertOne({
  user_id: userId,
  email: 'test.user.' + Date.now() + '@sailmorenow.dev',
  name: 'Test Sailor',
  picture: 'https://via.placeholder.com/150',
  account_type: 'sailor',
  primary_market: 'Greater Seattle',
  markets: ['Greater Seattle'],
  onboarding_complete: true,
  subscription_tier: 'free',
  newsletter_opt_in: true,
  created_at: new Date()
});
db.user_sessions.insertOne({
  user_id: userId,
  session_token: sessionToken,
  expires_at: new Date(Date.now() + 7*24*60*60*1000),
  created_at: new Date()
});
print('Session token: ' + sessionToken);
print('User ID: ' + userId);
"
```

## Step 2: Test Backend API

```bash
# Auth
curl -X GET "$BACKEND/api/auth/me" -H "Authorization: Bearer $TOKEN"

# Boat Pros
curl -X GET "$BACKEND/api/boat-pros?market=Greater+Seattle"

# Community posts
curl -X GET "$BACKEND/api/posts" -H "Authorization: Bearer $TOKEN"

# Events
curl -X GET "$BACKEND/api/events"
```

## Step 3: Browser Testing

```python
await page.context.add_cookies([{
    "name": "session_token",
    "value": TOKEN,
    "domain": "app-host",
    "path": "/",
    "httpOnly": True,
    "secure": True,
    "sameSite": "None"
}])
await page.goto(URL)
```
