# Private artifact preservation

This is a proposal for durable private preservation, not authorization to upload,
share, encrypt, change keys, delete a copy, or publish a dataset. No off-machine
backup has been created or verified. Public demo approval and repository history
review remain separate work.

## Verified local state

On **2026-10-11 at 18:55:32 UTC**, the original checkout at
`83b8ded09906aff025d936fa665ab1d33a158f6b` and its existing backup were checked
without creating another artifact copy. The backup records source revision
`abe494d9922faf6af425075259afcf0c93dba557`.

| Inventory | Files | Bytes |
| --- | ---: | ---: |
| JSON artifacts | 196 | 46,689,455 |
| HTML reports | 14 | 11,761,399 |
| Markdown artifacts | 3 | 11,565 |
| Script artifact | 1 | 1,842 |
| **Total** | **214** | **58,464,261** |

The existing [preservation CLI](../scripts/preserve-private-artifacts.mjs)
verified every backup file against its saved manifest. The repository's
[inventory helper](../scripts/lib/private-artifacts.mjs) independently inventoried
the originals; all relative paths, byte counts, SHA-256 values, and recorded
source modes matched. None of these 214 originals is currently tracked. This
establishes preservation of that artifact set, not content safety, interpretation
accuracy, or history clearance.

The existing backup remains at:

```text
/workspace/evolution-atlas-private-artifacts/abe494d9922faf6af425075259afcf0c93dba557
```

Its `manifest.json` has SHA-256:

```text
eb3ec8c1d7f6743087f0b567b79678359f499feac3006803a375ff082fc8c09d
```

Originals and backup are in the same cloud environment. They provide two verified
local copies, while off-machine durability remains unverified. Preserve both.
The backup layout is `manifest.json` plus `files/` containing the saved relative
paths. The manifest holds the per-file provenance and integrity metadata.

Detailed size/hash metadata and verification evidence are available only in the
original checkout's ignored local directory:

```text
scratch/artifact-preservation-review-83b8ded/
```

`aggregate.json` records the result; `backup-verification.json` records the CLI
verification; `detailed-inventory.json` lists file paths, sizes, hashes, source
modes, and tracking state. These are private review material. This tracked
proposal omits the individual artifact filenames and contains no artifact
contents or contributor records.

## Destination choices and required decisions

Choose an exact destination and owner before preparing an export. For every
choice, explicitly approve the artifact scope, destination, permitted readers,
retention period, encryption arrangement, and recovery custodian. The current
scope is the complete 214-file set and its manifest; a smaller selection needs
its own recorded inventory. No account, recipient, folder, bucket, region, or
encryption key has been selected.

| Choice | Prerequisites and authorization | Access and retention | Recovery evidence required |
| --- | --- | --- | --- |
| Local archive | Name the user-owned machine and absolute destination outside repositories and web assets; confirm capacity; select an existing approved encryption tool and key/passphrase custody arrangement. Explicitly authorize export and transfer of the named private scope. If no encryption arrangement exists, settle tool and custody before any key creation. | Restrict storage to the approved owner/readers. Name an independent second storage location or medium, retention period, and who can remove expired copies. A copy on this cloud machine is insufficient. | Verify the received encrypted archive checksum; decrypt into a new private directory on the destination machine; verify all 214 files with the preservation CLI. Confirm recovery does not depend on credentials or keys available only in the original cloud environment. |
| Object store | Specify provider, account/project, bucket and prefix, region, and exact approved principals. Verify the configured encryption/key custody, private access policy, upload/read permissions, and restore tooling. Explicitly authorize this scope at that destination; credentials remain outside source and logs. | Disable public access and anonymous reads. Confirm inherited policies, versioning or retention protection, recovery-owner access, lifecycle/deletion rules, and costs before enabling them. No storage configuration or policy change is authorized by this proposal. | Retrieve the uploaded object/version into a new private directory, verify its checksum, decrypt if applicable, and run the preservation CLI on the recovered layout. Record the object/version identity and verify restoration without the original workspace. |
| Private drive | Name the Drive or managed-file service, account, exact private folder, owner, and approved readers. Check inherited sharing and link settings, upload limits, version retention, export/restore behavior, and the existing encryption arrangement. Explicitly authorize transfer of the scope to that folder. | Disable public/link sharing; confirm who can list, download, share, and delete. Agree on retention and version-loss behavior. Treat filenames and the manifest as private metadata; package them within the encrypted archive when that is the approved arrangement. | Download/export the actual retained file/version through the chosen account; verify checksum and decrypted manifest contents in a new private directory. Record the file/version identity and prove recovery does not depend on an expiring workspace link or one unavailable account. |

Service capabilities and policies have not been inspected. Confirm them on the
chosen destination before authorizing transfer; an upload success alone does not
establish retention, private access, or recoverability. Keep encryption keys and
recovery instructions available to the authorized custodian separately from the
archive; do not place secrets in this repository or its private metadata logs.

## Ordered preservation procedure after approval

1. Reverify the current backup and original inventory. Record the approved scope
   and manifest hash, and stop if any path, byte count, or hash differs.
2. Record the exact destination, owner/readers, retention and deletion policy,
   existing encryption arrangement, and recovery custodian. Obtain explicit
   authorization for the concrete export/transfer and any needed storage-policy
   changes. No transfer follows from approving this document alone.
3. Prepare the approved export outside tracked, public, and build paths. Include
   the original manifest and complete `files/` layout; preserve the original
   revision and per-file hashes. If using encryption, use only the agreed
   arrangement and record the encrypted package's checksum separately. Avoid
   unnecessary plaintext staging copies.
4. Transfer to the approved private destination. Check the actual destination
   access settings and retained object/file/version identity, and verify the
   received package checksum. Store operational identifiers in private recovery
   notes rather than this tracked document.
5. Perform a recovery drill on the destination or another authorized machine.
   Restore/decrypt into a new empty private directory, then run the existing CLI
   against the recovered backup layout. Inspect its result: 214 files,
   58,464,261 bytes, the preserved source revision, and the exact manifest hash.
6. Record recovery evidence, independent-copy locations, custody availability,
   and the agreed next verification date. Retain both current copies and the
   off-machine copy; deletion, rotation, recurring checks, sharing, and public
   release each require their own authorization.

## Verification and recovery commands

Run this read-only check from a trusted Evolution Atlas checkout containing the
preservation CLI; the recorded verification used revision
`83b8ded09906aff025d936fa665ab1d33a158f6b`. Verification needs Node and the local
files, without dependency installation, a remote repository fetch, or a model
call:

```sh
node scripts/preserve-private-artifacts.mjs --verify \
  --destination /workspace/evolution-atlas-private-artifacts/abe494d9922faf6af425075259afcf0c93dba557
```

After an authorized restore or decryption, point the same check at the new
private recovery directory containing `manifest.json` and `files/`:

```sh
node scripts/preserve-private-artifacts.mjs --verify \
  --destination /absolute/private/recovery-directory
```

The CLI checks the exact relative file inventory and every size/hash; compare
its returned `manifestSha256`, `revision`, `files`, and `bytes` to the values
above. A package or service checksum alone validates transfer of that package,
not the recovered artifact set. Preserve private file permissions during
recovery. Do not restore real data into `public/`, add it to the publication
allowlist, or overwrite the originals as part of a recovery drill.

Completion means an explicitly approved independent private destination holds
the approved set, the access/retention/custody facts are recorded, and a full
recovery drill passes. Until then, the verified cloud-local backup remains the
recovery source and the durable off-machine backup remains outstanding.
