# @kit/api

Express HTTP surface: authentication, kit CRUD, item mutations, the durable
generation worker, SSE progress and the practice/report endpoints. Owns all
MongoDB access.

Deployed to Render as a long-lived process (required for SSE and the
in-process worker). Durable job state lives in MongoDB so a process restart
does not lose or corrupt a generation run. See
[../../docs/STATE_MODEL.md](../../docs/STATE_MODEL.md).
