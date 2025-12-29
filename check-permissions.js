/**
 * Script to check and optionally fix admin_permissions tables
 * Run with: node check-permissions.js
 * 
 * Make sure DATABASE_URL or DATABASE_PUBLIC_URL is set in your environment
 */

const { Client } = require('pg');

async function checkPermissions() {
  const connectionString = process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL;
  
  if (!connectionString) {
    console.error('❌ Error: DATABASE_URL or DATABASE_PUBLIC_URL environment variable is required');
    console.log('\nUsage: DATABASE_URL="your_connection_string" node check-permissions.js');
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🔌 Connecting to database...');
    await client.connect();
    console.log('✅ Connected successfully\n');

    // Check admin_permissions table
    console.log('📊 Checking admin_permissions table...');
    const permissionsCount = await client.query('SELECT COUNT(*) as count FROM admin_permissions');
    console.log(`   Total permissions: ${permissionsCount.rows[0].count}`);

    // Check admin_permissions_role_lnk table
    console.log('\n📊 Checking admin_permissions_role_lnk table...');
    const linksCount = await client.query('SELECT COUNT(*) as count FROM admin_permissions_role_lnk');
    console.log(`   Total permission-role links: ${linksCount.rows[0].count}`);

    // Check for orphaned permissions (permissions not linked to any role)
    console.log('\n🔍 Checking for orphaned permissions...');
    const orphaned = await client.query(`
      SELECT ap.id, ap.action 
      FROM admin_permissions ap
      LEFT JOIN admin_permissions_role_lnk lnk ON ap.id = lnk.permission_id
      WHERE lnk.permission_id IS NULL
    `);
    
    if (orphaned.rows.length > 0) {
      console.log(`   ⚠️  Found ${orphaned.rows.length} orphaned permissions (not linked to any role)`);
      console.log('   Sample actions:', orphaned.rows.slice(0, 5).map(r => r.action).join(', '));
    } else {
      console.log('   ✅ No orphaned permissions found');
    }

    // Check admin roles
    console.log('\n📊 Checking admin_roles table...');
    const roles = await client.query('SELECT id, name, code FROM admin_roles ORDER BY id');
    console.log('   Roles:');
    roles.rows.forEach(role => {
      console.log(`     - ${role.id}: ${role.name} (${role.code})`);
    });

    // Check permissions per role
    console.log('\n📊 Permissions per role:');
    const permsPerRole = await client.query(`
      SELECT ar.name, ar.code, COUNT(lnk.permission_id) as perm_count
      FROM admin_roles ar
      LEFT JOIN admin_permissions_role_lnk lnk ON ar.id = lnk.role_id
      GROUP BY ar.id, ar.name, ar.code
      ORDER BY ar.id
    `);
    permsPerRole.rows.forEach(row => {
      const status = row.perm_count > 0 ? '✅' : '⚠️ ';
      console.log(`   ${status} ${row.name}: ${row.perm_count} permissions`);
    });

    // Check if Super Admin has permissions
    const superAdminPerms = await client.query(`
      SELECT COUNT(*) as count
      FROM admin_permissions_role_lnk lnk
      JOIN admin_roles ar ON lnk.role_id = ar.id
      WHERE ar.code = 'strapi-super-admin'
    `);
    
    if (parseInt(superAdminPerms.rows[0].count) === 0) {
      console.log('\n❌ PROBLEM DETECTED: Super Admin role has NO permissions!');
      console.log('   This is likely the cause of your error.');
      console.log('\n   To fix this, you can either:');
      console.log('   1. Run this script with --fix flag to attempt automatic repair');
      console.log('   2. Create a fresh Strapi instance and copy the admin_permissions tables');
    } else {
      console.log(`\n✅ Super Admin has ${superAdminPerms.rows[0].count} permissions assigned`);
    }

    // If --fix flag is passed, attempt to fix
    if (process.argv.includes('--fix')) {
      console.log('\n🔧 Attempting to fix permissions...');
      
      // Get Super Admin role ID
      const superAdminRole = await client.query(`
        SELECT id FROM admin_roles WHERE code = 'strapi-super-admin'
      `);
      
      if (superAdminRole.rows.length === 0) {
        console.log('   ❌ Super Admin role not found. Cannot proceed.');
        return;
      }
      
      const roleId = superAdminRole.rows[0].id;
      
      // Link all permissions to Super Admin role
      const insertResult = await client.query(`
        INSERT INTO admin_permissions_role_lnk (permission_id, role_id, permission_ord)
        SELECT ap.id, $1, ROW_NUMBER() OVER (ORDER BY ap.id)
        FROM admin_permissions ap
        WHERE NOT EXISTS (
          SELECT 1 FROM admin_permissions_role_lnk lnk 
          WHERE lnk.permission_id = ap.id AND lnk.role_id = $1
        )
      `, [roleId]);
      
      console.log(`   ✅ Linked ${insertResult.rowCount} permissions to Super Admin role`);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
    console.log('\n🔌 Database connection closed');
  }
}

checkPermissions();
