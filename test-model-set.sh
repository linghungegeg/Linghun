#!/bin/bash
# Quick smoke test for /model set command

set -e

echo "=== Testing /model set command ==="
echo ""

# Test 1: Invalid model
echo "Test 1: /model set not-a-real-model (should error)"
printf '/model set not-a-real-model\n/exit\n' | corepack pnpm exec linghun 2>&1 | grep -E "(错误|未找到)" || echo "FAIL: Should show error for invalid model"

echo ""
echo "Test 2: Valid model (assuming deepseek-chat is configured)"
printf '/model set deepseek-chat\n/model\n/exit\n' | corepack pnpm exec linghun 2>&1 | grep -E "(已设置|deepseek-chat)" || echo "FAIL: Should confirm model set"

echo ""
echo "=== Tests complete ==="
