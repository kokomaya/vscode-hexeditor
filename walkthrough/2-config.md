# Check how it is parsed

The **Dump & Config** view (NVM Studio sidebar) shows, for the active dump:

| Item | Meaning |
| --- | --- |
| Status | How many blocks were loaded — or why none were |
| Layout profile | Which descriptor is used (*Auto* or pinned) |
| Descriptors | The `*.nvmlayout.json` files found and how they parse |
| Source files | Files a descriptor needs (✓ found / ✗ missing) |
| External engine | Whether a vendor engine is allowed to run |

Every item is clickable to fix it. Stuck? Ask `@nvm /why`.
