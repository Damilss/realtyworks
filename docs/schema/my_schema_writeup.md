# realtyworks workflow writeup (schema)

## Tenat (brainstorming, not concrete)
- Submits work requests
- Emergency contact -> contact landlord
- submits rent payment / proof of payment (Payment is not handled through app)
- Messenger for landlord

## Repair / handmyman (brainstorming, not concrete)
- Unique links for work orders
- pictures of expenses / receipts
- Messenger for landlord? or keep without contact
- Work order / pending completed -> notification sent to landlord: tenat

## landlord (brainstorming, not concrete)
- Monitors stats and information
- recieves messages, exports possible accounting data
- Landlord has 2 business days to respond to work orders

> Side note: Accounting work / rent tracking will be included in late MVP

# Schema workflows / planning (schema)

## Nouns
- landlord
- tenat
- properties 
- unit 
- work order
- message
- receipt
- rent / payments
- manager
- account / accounting_data
- money
- images / pictures
- status 
- activity log / audit log
- maps 
- user
- bookkeeper
- contact
- reports
- priority
- profile
- unique links (https://)
- notification
- stats
- notes
- vendor / handyman
- conversations


## Actions w/ Nouns
- create work orders
- landlord sends message
- tenat requests work order
- landlord creates work order
- landlord checks accounting data 
- vendor uploads photos for work order
- handler updates status of work order
- handler creates priorities for pending work orders
- vendor/handyman uploads photos of receipts
- tenat updates rent due
- activity log / audit log gets updates / new entry
- profile photo gets updated
- profile name / contact information gets updated
- report gets uploaded 
- handyman uploads photos of finished job
- status gets updated
- when work oeder gets created, unique link gets created to be forwarded to handyman ( see other documentation for further information on how we handle this problem )
- handyman/vendor uploads notes to work orde r
- landlord gets notified when statuses for work orders are uploaded
- Tenat requests work order with description and images.
- Landlord forwards SMS unique link to handyman

## What requires their own table?
| Noun | Table? | Why? |
| --- | --- | --- | 
| landlord | yes | constact info, permissions, etc | 
| Vendor | Yes | assignment status uploads |
| Unit | yes | Assigned work orders / relational | 
| Tenat | Maybe? | queried roles? / permissions | 
| property | no | can be a column? | 
| work order  | yes | statuses, permissions, quiered often, etc | 
| message | no | can live in conversations | 
| Profile | yes | hold metadata for pfp, name, etc | 
| audit log | Yes | Need I say more | 
| Rent payments | Yes | tracking for years / months of payments | 
| Contact | No | can be column | 
| User | yes | Permissions and roles, manager, landlord, tenat | 
| Book keeper | Yes | Permissions etc, same as other roles | 
| reports | Yes | Text, images receipts | 
| receipt | no | column | 
| link | no | column for work order |

