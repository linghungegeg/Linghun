SELECT id, name, email
FROM users
WHERE status = 'active'
  AND created_at > '2024-01-01'
ORDER BY name ASC;
