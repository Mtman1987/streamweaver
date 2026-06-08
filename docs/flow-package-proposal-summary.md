# Flow Package Proposal Summary

Generated on 2026-06-07T16:09:43.125Z.

## Totals

- Flow packages: `141`

## Package Kinds

Kind         | Count
---          | ---  
action_flow  | 73   
command_flow | 68   

## Freeze Tiers

Freeze Tier      | Count
---              | ---  
built_in_module  | 5    
legacy_hold      | 11   
official_library | 67   
starter          | 58   

## Collections

Collection   | Count
---          | ---  
Redeems      | 23   
Core Utility | 18   
Economy      | 17   
Social       | 17   
Events       | 16   
Deprecated   | 8    
Misc         | 8    
Counters     | 6    
Pokemon      | 5    
Welcome      | 5    
Advanced     | 3    
Games        | 3    
Hidden       | 3    
Overlays     | 3    
Integrations | 2    
AI           | 1    
Clips        | 1    
Music        | 1    
Utility      | 1    

## Rules

- The install/export unit is one flow package, not a broad bundle.
- Similar commands like `!fistbump` and `!highfive` remain separate flow packages.
- Multiple commands/actions stay together only when they appear to implement one user-facing flow.
- Hidden support files are excluded from standalone flow packaging unless they are still needed for migration visibility.
