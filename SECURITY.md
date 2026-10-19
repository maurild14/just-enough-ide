# Security policy

## Reporting a vulnerability

Please report vulnerabilities through GitHub private vulnerability reporting on
this repository (Security tab, "Report a vulnerability"). Do not open a public
issue for a security problem. We will acknowledge the report and keep you
updated until it is resolved.

## Supported versions

Only the latest minor release receives security fixes.

## Scope

JEI runs `git` and reads and writes files on your machine, in the project you
open. It sends nothing over the network itself. The only model calls are the
ones you start (Generate and Ask), through your own host session and provider,
and `git fetch`, `pull` and `push` talk to your own remotes.

In scope: command or argument injection in the processes JEI starts, writes
outside the project root, and staging or exposing files that look like secrets.
