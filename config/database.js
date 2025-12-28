module.exports = ({ env }) => ({
    connection: {
        client: 'postgres',
        connection: {
            connectionString: env('DATABASE_PUBLIC_URL') || env('DATABASE_URL'),
            ssl: env('DATABASE_SSL', 'false') === 'true' ? {
                rejectUnauthorized: env('DATABASE_SSL_REJECT_UNAUTHORIZED', 'true') === 'true'
            } : false
        },
        debug: false,
        pool: { min: 0, max: 7 },
    }
});