import connectDB from './index.js';

export const ensureReceptionActivityTables = async () => {
  const pool = connectDB();
  const connection = await pool.getConnection();

  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS reception_call_transfers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        business_center_id INT NOT NULL,
        team_id INT DEFAULT NULL,
        team_name VARCHAR(255) DEFAULT NULL,
        member_id INT DEFAULT NULL,
        member_name VARCHAR(255) DEFAULT NULL,
        member_email VARCHAR(255) DEFAULT NULL,
        extension VARCHAR(50) DEFAULT NULL,
        created_by INT DEFAULT NULL,
        date_created TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        KEY idx_reception_transfer_business_time (business_center_id, date_created),
        KEY idx_reception_transfer_team_time (team_id, date_created),
        CONSTRAINT fk_reception_transfer_business
          FOREIGN KEY (business_center_id) REFERENCES business_center(id)
          ON DELETE CASCADE
      )
    `);
  } finally {
    connection.release();
  }
};
