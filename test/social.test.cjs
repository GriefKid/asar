const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

const owner = '00000000-0000-4000-8000-000000000001';
const reader = '00000000-0000-4000-8000-000000000002';
const stranger = '00000000-0000-4000-8000-000000000003';

test('social access requires approval, blocks revoke it, and an account cannot change admin status', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema auth to authenticated;
      grant execute on function auth.uid() to authenticated;
    `);
    await db.exec(fs.readFileSync('supabase-setup.sql', 'utf8'));
    await db.exec('grant all on public.profiles, public.user_data to authenticated');
    const legacy = '00000000-0000-4000-8000-000000000004';
    await db.query('insert into auth.users values ($1, $2, $3)', [legacy, 'legacy@example.invalid', {}]);
    await db.exec(fs.readFileSync('supabase/migrations/202611270001_profiles_and_sharing.sql', 'utf8'));
    await db.exec(fs.readFileSync('supabase/migrations/202611280001_auto_social_profiles.sql', 'utf8'));
    assert.equal((await db.query('select discoverable from public.asar_profiles where id = $1', [legacy])).rows[0].discoverable, false);
    for (const [id, name] of [[owner, 'owner'], [reader, 'reader'], [stranger, 'stranger']]) {
      await db.query('insert into auth.users values ($1, $2, $3)', [id, name + '@example.invalid', { display_name: name, asar_discoverable: name === 'owner' }]);
      const profile = (await db.query('select username, display_name, discoverable from public.asar_profiles where id = $1', [id])).rows[0];
      assert.match(profile.username, /^asar_[a-f0-9]{19}$/);
      assert.equal(profile.display_name, name);
      assert.equal(profile.discoverable, name === 'owner');
      await db.query('update public.asar_profiles set username = $1 where id = $2', [name, id]);
    }
    const switchTo = async id => {
      await db.exec('set role authenticated');
      await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    };
    await switchTo(owner);
    await db.query("insert into public.asar_shared_works (owner,work_id,title,kind,stage) values ($1,'work','Shared book','book','done')", [owner]);
    await db.query('insert into public.user_data (id) values ($1)', [owner]);
    await switchTo(reader);
    assert.equal((await db.query('select * from public.asar_find_profile($1)', ['owner'])).rows[0].id, owner);
    assert.equal((await db.query('select * from public.asar_find_profile($1)', ['stranger'])).rows.length, 0);
    assert.equal((await db.query('select * from public.asar_shared_works')).rows.length, 0);
    assert.equal((await db.query('select * from public.user_data')).rows.length, 0);
    assert.equal((await db.query('select email from public.profiles')).rows.length, 1);
    await assert.rejects(db.query('update public.profiles set is_admin = true where id = $1', [reader]), /permission denied/i);
    await assert.rejects(db.query("insert into public.asar_follows values ($1,$2,'accepted')", [reader, owner]), /row-level security/i);
    await db.query('insert into public.asar_follows (requester,owner) values ($1,$2)', [reader, owner]);
    assert.equal((await db.query("update public.asar_follows set status = 'accepted' returning status")).rows.length, 0);
    await switchTo(owner);
    assert.equal((await db.query("update public.asar_follows set status = 'accepted' returning status")).rows.length, 1);
    await switchTo(reader);
    assert.equal((await db.query('select title from public.asar_shared_works')).rows[0].title, 'Shared book');
    assert.equal((await db.query('select * from public.user_data')).rows.length, 0);
    await switchTo(stranger);
    assert.equal((await db.query('select title from public.asar_shared_works')).rows.length, 0);
    await switchTo(owner);
    await db.query('select public.asar_block_profile($1)', [reader]);
    await switchTo(reader);
    assert.equal((await db.query('select * from public.asar_find_profile($1)', ['owner'])).rows.length, 0);
    assert.equal((await db.query('select title from public.asar_shared_works')).rows.length, 0);
    await assert.rejects(db.query('insert into public.asar_follows (requester,owner) values ($1,$2)', [reader, owner]), /row-level security/i);
  } finally {
    await db.close();
  }
});
