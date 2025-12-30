module.exports = ({ env }) => {
    // Use internal URL on Railway (free private network), public URL for local dev
    const isRailway = env('RAILWAY_ENVIRONMENT_NAME') || env('RAILWAY_PROJECT_ID');
    const connectionString = isRailway 
        ? env('DATABASE_URL')           // Internal: postgres.railway.internal (free)
        : env('DATABASE_PUBLIC_URL');   // Public: crossover.proxy.rlwy.net (for local dev)
    
    return {
        connection: {
            client: 'postgres',
            connection: {
                connectionString,
                ssl: env('DATABASE_SSL', 'false') === 'true' ? {
                    rejectUnauthorized: env('DATABASE_SSL_REJECT_UNAUTHORIZED', 'true') === 'true'
                } : false
            },
            debug: false,
            pool: { min: 0, max: 7 },
        }
    };
};