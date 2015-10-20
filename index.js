var Promise = require('lie')
var cuid = require('cuid')

require('pg-promise/node_modules/pg').defaults.ssl = true
var pgp = require('pg-promise')({promiseLib: Promise})

var handle = function (message) {
  return function (err) {
    console.log(message + ':', err)
    throw err
  }
}

var pgjson = (function () {
  function pgjson (cn) {
    this.db = pgp(cn)

    this.wait = Promise.resolve()
    this.init()
  }

  pgjson.prototype.post = function (doc) {
    var db = this.db
    doc._id = cuid()

    return this.wait.then(function () {
      return db.query(
        'INSERT INTO pgjson.main (id, doc) VALUES ($1, $2) RETURNING id',
        [doc._id, doc]
      )
    })
    .then(function (rows) {
      return {ok: true, id: rows[0].id}
    })
    .catch(handle('problem posting doc'))
  }

  pgjson.prototype.put = function (doc) {
    var db = this.db

    return this.wait.then(function () {
      return db.query('SELECT pgjson.upsert($1, $2::jsonb)', [doc._id, doc])
    })
    .then(function () {
      return {ok: true, id: doc._id}
    })
    .catch(handle('problem putting doc'))
  }

  pgjson.prototype.get = function (id) {
    var db = this.db

    return this.wait.then(function () {
      return db.query('SELECT doc FROM pgjson.main WHERE id = $1', [id])
    })
    .then(function (rows) {
      return rows[0].doc
    })
    .catch(handle('problem getting doc'))
  }

  pgjson.prototype.count = function () {
    var db = this.db

    return this.wait.then(function () {
      return db.query('SELECT count(*) AS c FROM pgjson.main')
    })
    .then(function (rows) {
      return rows[0].c
    })
    .catch(handle('problem counting docs'))
  }

  pgjson.prototype.listIds = function () {
    var db = this.db

    return this.wait.then(function () {
      return db.query('SELECT id FROM pgjson.main')
    })
    .then(function (rows) {
      return rows.map(function (r) { return r.id })
    })
    .catch(handle('problem listing ids'))
  }

  pgjson.prototype.del = function (id) {
    var db = this.db

    return this.wait.then(function () {
      return db.query('DELETE FROM pgjson.main WHERE id = $1', [id])
    })
    .then(function (rows) {
      return {ok: true}
    })
    .catch(handle('problem deleting doc'))
  }

  pgjson.prototype.init = function () {
    var db = this.db

    this.wait = this.wait.then(function () {
      return db.query('CREATE SCHEMA IF NOT EXISTS pgjson')
    }).then(function () {
      return db.query('CREATE TABLE IF NOT EXISTS pgjson.main ( id text PRIMARY KEY, doc jsonb )')
    })
    .then(function () {
      return db.query(
        'CREATE OR REPLACE FUNCTION pgjson.upsert(key text, data jsonb) \n\
        RETURNS VOID AS \n\
        $$ \n\
        BEGIN \n\
            LOOP \n\
                -- first try to update the key \n\
                -- note that id must be unique \n\
                UPDATE pgjson.main SET doc = data WHERE id = key; \n\
                IF found THEN \n\
                    RETURN; \n\
                END IF; \n\
                -- not there, so try to insert the key \n\
                -- if someone else inserts the same key concurrently, \n\
                -- we could get a unique-key failure \n\
                BEGIN \n\
                    INSERT INTO pgjson.main(id, doc) VALUES (key, data); \n\
                    RETURN; \n\
                EXCEPTION WHEN unique_violation THEN \n\
                    -- do nothing, and loop to try the UPDATE again \n\
                END; \n\
            END LOOP; \n\
        END; \n\
        $$ \n\
        LANGUAGE plpgsql \n\
        '
      )
    })
    .catch(handle('could not initialize pgjson schema, table and functions'))

    return this.wait
  }

  pgjson.prototype.purgeAll = function () {
    var db = this.db

    this.wait = this.wait.then(function () {
      return db.query('DROP SCHEMA pgjson CASCADE')
    })
    .catch(handle('problem purging schema'))

    return this.wait
  }

  return pgjson
})()

module.exports = pgjson