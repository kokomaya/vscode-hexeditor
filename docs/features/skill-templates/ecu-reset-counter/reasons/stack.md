# 栈监控类复位（FS_RESET_STACK_*）

- 触发：`FS_Stack.c`（`FS_Stack_v_Cat2Reaction(FS_RESET_STACK_OVERFLOW, …)`）。
- MAP 15：`e_SharedInfoID = STACK`（7）→ `Shared.Stacks.a_FillGrades[]`：各栈使用率（%），最多 `FS_SAFE_SECTION_NUMBER_OF_STACKS`（80）个。
- MAP 16 另有 `FS_Stack2.c`：`STACK_1`（7）→ `Shared.Stacks1.a_FillGrades[]`；
  `STACK_2`（8）→ `Shared.Stacks2.a_Stacks[i] = { u_OwnerId:16, u_TaskId:9, u_FillGrade:7 }`。
- 上下文 `a_ResetContextData`：TODO（见 `FS_Stack_v_Cat2Reaction`）。

排查：找出 `FillGrade` 最高的栈（TODO：栈序号 → 任务 / 核的映射表）；对比多次复位是否同一个栈。
