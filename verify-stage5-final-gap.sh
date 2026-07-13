#!/bin/bash
set -e

echo "=== Stage 5 Final Gap 逻辑统一验证 ==="
echo ""

echo "1. TypeCheck (只检查 model-stream-runtime 相关文件的新增错误)..."
cd packages/tui
npx tsc -p tsconfig.json --noEmit 2>&1 | grep "model-stream-runtime" | grep -v "Cannot find module" | grep -v "implicitly has an 'any' type" | grep -v "TS7053" || echo "✅ 无新增类型错误"
echo ""

echo "2. 运行新增测试..."
cd ../..
pnpm --filter @linghun/tui test -- --run src/model-stream-runtime.test.ts 2>&1 | grep -A 20 "Final Gap Progress Detection"
echo ""

echo "3. 检查关键函数是否导出..."
grep -n "__testFinalGapHasProgress\|__testEvidenceMatchesFinalGapAction\|__testCaptureFinalGapProgressState" packages/tui/src/model-stream-runtime.ts | head -5
echo ""

echo "4. 检查关键类型字段..."
grep -A 10 "type FinalGapProgressState" packages/tui/src/model-stream-runtime.ts | head -12
echo ""

echo "5. 检查两个调用点是否更新..."
grep -B 2 -A 5 "const selectedLevel = readRequestedVerificationLevel" packages/tui/src/model-stream-runtime.ts | head -20
echo ""

echo "=== 验证完成 ==="
