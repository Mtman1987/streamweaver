# Code signing policy

Free code signing is provided by [SignPath.io](https://signpath.io/), with a
certificate provided by [SignPath Foundation](https://signpath.org/).

## Roles

- Committer and reviewer: [Mtman1987](https://github.com/Mtman1987)
- Signing approver: [Mtman1987](https://github.com/Mtman1987)

Every signed release is built from this public repository on a GitHub-hosted
runner. The unsigned installer is uploaded as a GitHub Actions artifact before
the SignPath request is created. SignPath verifies its build origin, requires
release approval, signs only the declared SpaceMountain Companion installer,
and returns the signed artifact to the same workflow.

The workflow rejects an installer unless Windows reports a valid Authenticode
signature from SignPath Foundation with a trusted timestamp. Only then does it
write the checksum and update metadata and publish the GitHub release.

See the [Companion privacy policy](PRIVACY.md) for its local storage and network
behavior.
