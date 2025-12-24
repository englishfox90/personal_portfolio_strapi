module.exports = ({ env }) => ({
    connection: {
        client: 'postgres',
        connection: {
            connectionString: env('DATABASE_PUBLIC_URL') || env('DATABASE_URL')
        },
        debug: false,
        pool: { min: 0, max: 7 },
    }
});