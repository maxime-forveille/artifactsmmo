# Artifacts MMO Bot

This context coordinates an autonomous crew while keeping game operations,
bounded execution, and cross-character decisions distinct.

## Language

**Action**:
One elementary operation accepted by Artifacts MMO, such as moving, gathering,
fighting, crafting, resting, or using the bank.
_Avoid_: Activity, task

**Activity**:
A bounded workflow composed of one or more actions, executed for one character
before the orchestrator observes the crew again and chooses what comes next.
_Avoid_: Action, strategy, forever task
