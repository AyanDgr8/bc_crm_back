import connectDB from './index.js';

export const ensureTeamSchema = async () => {
    const pool = connectDB();
    const connection = await pool.getConnection();

    try {
        const [tables] = await connection.query("SHOW TABLES LIKE 'teams'");
        if (tables.length === 0) {
            return;
        }

        const [columns] = await connection.query("SHOW COLUMNS FROM teams LIKE 'team_extension'");

        if (columns.length === 0) {
            await connection.query(
                "ALTER TABLE teams ADD COLUMN team_extension VARCHAR(50) NOT NULL DEFAULT '' AFTER team_name"
            );
        }
    } finally {
        connection.release();
    }
};
