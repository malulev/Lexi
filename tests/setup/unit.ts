// Unit tests never reach the network, Docker, or a real repository.
// Any module needing configuration reads it from here.
process.env.TZ = 'UTC';
