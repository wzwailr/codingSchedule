import type {DatabaseSync,StatementSync} from 'node:sqlite';

const caches=new WeakMap<DatabaseSync,Map<string,StatementSync>>();
export function prepared(db:DatabaseSync,sql:string):StatementSync{
  let cache=caches.get(db);if(!cache){cache=new Map();caches.set(db,cache);}
  let statement=cache.get(sql);
  if(!statement){
    // SQL comes from the repository, never user input. Bound even if future
    // maintenance introduces more distinct queries; the connection owns them.
    if(cache.size>=128)cache.clear();
    statement=db.prepare(sql);cache.set(sql,statement);
  }
  return statement;
}
export function releaseStatements(db:DatabaseSync):void{caches.delete(db);}
