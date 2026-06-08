# Flow Package Manifest

The user-facing import/export unit is a single flow package.

## Rules

- One user-facing feature equals one package.
- Similar features are not bundled together just because they share a category.
- Commands, actions, and subactions that together implement one feature stay together inside that package.
- Browsing categories are separate from install units.

## Example

```json
{
  "packageId": "flow.fistbump",
  "kind": "command_flow",
  "installUnit": "flow",
  "name": "!fistbump",
  "sourceModule": "starter-social",
  "freezeTier": "starter",
  "visibility": "default",
  "collection": "Social",
  "commandFiles": [
    "commands/_fistbump_acbce1ae-4458-4f92-99d9-28f22fe93d7b.json"
  ],
  "actionFiles": [
    "actions/_fistbump_4b1d3846-27b8-41ca-813d-c64848128b0e.json"
  ],
  "dependencies": [],
  "notes": []
}
```

## Collections

Collections are only for browsing:

- Social
- Economy
- AI
- Pokemon
- Redeems
- Utility
- Events
- Integrations

Users may browse by collection, but installs should happen at the flow-package level unless they explicitly choose bulk install later.
