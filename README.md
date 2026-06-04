# Autonomous Customer Engagement Agent

An autonomous AI agent that converts a plain-English marketing goal into a fully segmented, personalised, and scheduled email campaign — with human-in-the-loop approval before anything sends.

Built with a real **ReAct (Reason + Act) architecture** — the agent doesn't make a single LLM call and stop. It plans across multiple steps, calls real tools against a live database, observes results, and replans dynamically. This is the pattern used in production AI systems at scale.

---

## Architecture

```
User Goal (natural language)
         │
         ▼
┌─────────────────────┐
│    CampaignAgent    │  ← ReAct planning loop (Gemini)
│   Reason → Act      │
│   → Observe → ...   │
└────────┬────────────┘
         │  tool calls
         ▼
┌─────────────────────────────────────────────┐
│                  Tool Layer                  │
│                                             │
│  queryCustomers    → MongoDB filter query   │
│  segmentCustomers  → high-value/mid/casual  │
│  generateMessages  → Gemini per-customer    │
│  buildPreview      → campaign object        │
│  finalize          → pending_approval       │
└─────────────────────────────────────────────┘
         │
         ▼
  Human Approval (CLI or REST API)
         │
         ▼
┌─────────────────────┐
│    BullMQ Queue     │  ← Redis-backed job queue
│    + Workers        │  ← 3 concurrent email workers
└─────────────────────┘
         │
         ▼
  Nodemailer SMTP  →  Customer inboxes
```

---

## What makes this a real agent

Most "AI agent" projects make one LLM call and call it done. This isn't that.

The agent receives the campaign goal and a list of available tools. Each iteration it:

1. **Thinks** — Gemini reasons about what data it has and what tool to call next
2. **Acts** — the tool executes against real MongoDB / Gemini API
3. **Observes** — results feed back into the next iteration's context
4. **Replans** — if a tool returns unexpected data, the agent adjusts

Typical execution flow:
```
Step 1: query_customers    → filters dormant/segment/city customers from DB
Step 2: segment_customers  → splits into high-value / mid / casual groups
Step 3: generate_messages  → Gemini writes a personalised email per customer
Step 4: build_preview      → assembles full campaign object with all messages
Step 5: finalize           → sets status to pending_approval, halts loop
```

The agent never sends a single email without explicit human approval. After the preview is shown, the operator approves, rejects with feedback (triggering replanning), or saves as draft.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript |
| Runtime | Node.js |
| Database | MongoDB + Mongoose |
| Queue | BullMQ on Redis |
| AI Model | Google Gemini (free tier) |
| Email | Nodemailer |
| API | Express |
| Infra | Docker Compose |

---

## Getting Started

### Prerequisites

- Node.js 18+
- Docker Desktop
- Google Gemini API key — free at https://aistudio.google.com/apikey

### Setup

```bash
# Install dependencies
npm install

# Start MongoDB and Redis
docker-compose up -d

# Configure environment
cp .env.example .env
# Set GEMINI_API_KEY in .env

# Seed 500 sample customers
npm run seed
```

### Run

```bash
# Interactive CLI
npm run cli

# REST API server
npm run dev
```

---

## CLI Usage

```
╔═══════════════════════════════════════════╗
║        CampaignMind — AgentOS v1.0        ║
║  Agentic Retail Marketing Orchestrator    ║
╚═══════════════════════════════════════════╝

  1  Create new campaign
  2  Review pending approvals
  3  List all campaigns
  4  View customer stats
  5  Exit
```

**Example campaign goals:**
```
Re-engage customers who haven't bought in 60 days with a 20% discount
Win back high-value customers in Mumbai who haven't ordered in 90 days
Send a weekend sale alert to casual buyers excluding recent discount recipients
```

### Import your own customers

```bash
npm run import data/customers/sample_customers.csv
```

CSV columns — `name` and `email` required, rest optional:
```
name, email, phone, city, total_spend, order_count, last_order_date, segment, tags
```

---

## REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /health | Health check |
| GET | /api/stats | Customer database stats |
| GET | /api/customers | Paginated customer list |
| POST | /api/campaigns | Create + auto-plan a campaign |
| GET | /api/campaigns | List all campaigns |
| GET | /api/campaigns/:id | Campaign details + messages |
| POST | /api/campaigns/:id/approve | Approve and execute |
| POST | /api/campaigns/:id/reject | Reject with reason |

**Create a campaign:**
```bash
curl -X POST http://localhost:3000/api/campaigns \
  -H "Content-Type: application/json" \
  -d '{"goal": "Re-engage dormant customers with 15% off"}'
```

---

## Project Structure

```
src/
├── agent/
│   └── campaignAgent.ts     ReAct planning loop — the brain
├── api/
│   └── server.ts            Express REST API
├── cli/
│   ├── index.ts             Interactive terminal UI
│   └── import.ts            CSV customer importer
├── db/
│   ├── connection.ts        Mongoose connection
│   └── seed.ts              500-customer seeder (Indian retail data)
├── models/
│   ├── Customer.ts          Customer schema + indexes
│   └── Campaign.ts          Campaign + messages schema
├── services/
│   ├── emailService.ts      Nodemailer (simulates if SMTP unconfigured)
│   └── queueService.ts      BullMQ job queue + worker
├── tools/
│   ├── customerTools.ts     query + segment tools
│   └── messageTools.ts      Gemini personalised message generation
└── utils/
    ├── config.ts            Environment config
    └── logger.ts            Chalk-based logger
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes | Free at aistudio.google.com/apikey |
| `MONGODB_URI` | No | Defaults to localhost:27017 |
| `REDIS_URL` | No | Defaults to localhost:6379 |
| `SMTP_USER` | No | Gmail address — sends are simulated if blank |
| `SMTP_PASS` | No | Gmail App Password |
| `PORT` | No | API port, defaults to 3000 |

---

## Key Engineering Decisions

**Why ReAct and not a single prompt?**
A single prompt can't query a database, segment customers, and generate 300 personalised messages. ReAct separates reasoning from execution — the LLM decides what to do, real functions do the work, results inform the next decision.

**Why BullMQ for email delivery?**
Campaign execution is decoupled from planning. Emails are queued as individual jobs with retry logic, backoff, and dead-letter handling. 3 concurrent workers process sends without blocking the main thread.

**Why human-in-the-loop approval?**
An agent that sends emails autonomously to hundreds of customers without review is a liability. The approval step is architectural — the agent always halts at `pending_approval` and execution requires explicit confirmation.

**Why MongoDB for campaigns?**
Campaign messages are a variable-length array of objects per campaign document. MongoDB's document model fits this naturally without schema migrations when message structure evolves.