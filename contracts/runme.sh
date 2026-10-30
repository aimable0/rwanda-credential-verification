# Test

# 1. Check how much gas the transaction used vs. the limit
cast receipt 0x73c87ac647b735405e089ed3542dfe53e0521d73a51e5cf405600f534becdf86 gasUsed status --rpc-url sepolia

# 2. Replay the transaction trace to see the exact opcode or error that failed
cast run 0x73c87ac647b735405e089ed3542dfe53e0521d73a51e5cf405600f534becdf86 --rpc-url sepolia
