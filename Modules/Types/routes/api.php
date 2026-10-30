<?php

declare(strict_types=1);

use League\Route\Http\Exception\BadRequestException;
use PhpPgAdmin\Core\Database\ConnectionPool;
use PhpPgAdmin\Core\Facades\Nodes;
use PhpPgAdmin\Core\Facades\Route;
use PhpPgAdmin\Core\Nodes\NodeContext;
use PhpPgAdmin\Modules\Auth\Http\Middleware\Authenticate;
use PhpPgAdmin\Modules\Types\Http\Controllers\CollationController;
use PhpPgAdmin\Modules\Types\Http\Controllers\DomainController;
use PhpPgAdmin\Modules\Types\Http\Controllers\FtsConfigurationController;
use PhpPgAdmin\Modules\Types\Http\Controllers\FtsDictionaryController;
use PhpPgAdmin\Modules\Types\Http\Controllers\FtsParserController;
use PhpPgAdmin\Modules\Types\Http\Controllers\FtsTemplateController;
use PhpPgAdmin\Modules\Types\Http\Controllers\OperatorClassController;
use PhpPgAdmin\Modules\Types\Http\Controllers\TypeController;
use Psr\Http\Message\ServerRequestInterface;

// Beyond the node operations: the lists the editors offer.
$context = static function (ServerRequestInterface $request, array $args, string $type): NodeContext {
    $db = rawurldecode($args['db']);
    if ($db === '') {
        throw new BadRequestException('A database name is required.');
    }
    $pool = ConnectionPool::from($request);

    return new NodeContext(Nodes::get($type), Nodes::registry(), $pool, $pool->for($db), $db, ['scid' => (int) $args['scid']], $request);
};

Route::middleware(Authenticate::class)->group(function () use ($context): void {
    // ?subtype=int4 also lists the operator classes a range on that subtype may use.
    Route::get('/databases/{db}/schemas/{scid:number}/types/options', function (ServerRequestInterface $request, array $args) use ($context): array {
        $ctx = $context($request, $args, 'type');

        return (new TypeController())->options($ctx, trim((string) ($ctx->queryParams()['subtype'] ?? '')));
    })->setName('types.options');

    Route::get('/databases/{db}/schemas/{scid:number}/domains/options', fn (ServerRequestInterface $request, array $args): array => (new DomainController())->options($context($request, $args, 'domain')))->setName('domains.options');

    // ALTER COLLATION … REFRESH VERSION, after the operating system's or ICU's collation version changed.
    Route::post('/databases/{db}/schemas/{scid:number}/collations/{coid:number}/refresh_version', fn (ServerRequestInterface $request, array $args): array => ['properties' => (new CollationController())->refreshVersion($context($request, $args, 'collation'), (int) $args['coid'])])->setName('collations.refresh_version');
    Route::get('/databases/{db}/schemas/{scid:number}/collations/options', fn (ServerRequestInterface $request, array $args): array => (new CollationController())->options($context($request, $args, 'collation')))->setName('collations.options');

    Route::get('/databases/{db}/schemas/{scid:number}/fts_configurations/options', fn (ServerRequestInterface $request, array $args): array => (new FtsConfigurationController())->options($context($request, $args, 'fts_configuration')))->setName('fts_configurations.options');
    // ?parser=<oid>: the token types the parser produces, which a configuration maps.
    Route::get('/databases/{db}/schemas/{scid:number}/fts_configurations/tokens', function (ServerRequestInterface $request, array $args) use ($context): array {
        $ctx = $context($request, $args, 'fts_configuration');
        $parser = (int) ($ctx->queryParams()['parser'] ?? 0);
        if ($parser <= 0) {
            throw new BadRequestException('A parser OID is required.');
        }

        return (new FtsConfigurationController())->tokens($ctx, $parser);
    })->setName('fts_configurations.tokens');
    Route::get('/databases/{db}/schemas/{scid:number}/fts_dictionaries/options', fn (ServerRequestInterface $request, array $args): array => (new FtsDictionaryController())->options($context($request, $args, 'fts_dictionary')))->setName('fts_dictionaries.options');
    Route::get('/databases/{db}/schemas/{scid:number}/fts_parsers/options', fn (ServerRequestInterface $request, array $args): array => (new FtsParserController())->options($context($request, $args, 'fts_parser')))->setName('fts_parsers.options');
    // Operator classes, operator families and conversions: listed, exported and dropped.
    Route::get('/databases/{db}/schemas/{scid:number}/opclasses', fn (ServerRequestInterface $request, array $args): array => ['rows' => (new OperatorClassController())->list($context($request, $args, 'type'))])->setName('opclasses.list');
    Route::get('/databases/{db}/schemas/{scid:number}/opclasses/options', fn (ServerRequestInterface $request, array $args): array => (new OperatorClassController())->options($context($request, $args, 'type')))->setName('opclasses.options');
    Route::post('/databases/{db}/schemas/{scid:number}/opclasses/{kind}/msql', fn (ServerRequestInterface $request, array $args): array => ['sql' => (new OperatorClassController())->createSql($context($request, $args, 'type'), (string) $args['kind'], (array) ($request->getParsedBody() ?? []))])->setName('opclasses.msql');
    Route::post('/databases/{db}/schemas/{scid:number}/opclasses/{kind}', function (ServerRequestInterface $request, array $args) use ($context): array {
        (new OperatorClassController())->create($context($request, $args, 'type'), (string) $args['kind'], (array) ($request->getParsedBody() ?? []));

        return ['ok' => true];
    })->setName('opclasses.create');
    Route::get('/databases/{db}/schemas/{scid:number}/opclasses/{kind}/{oid:number}/sql', fn (ServerRequestInterface $request, array $args): array => ['sql' => (new OperatorClassController())->sql($context($request, $args, 'type'), (string) $args['kind'], (int) $args['oid'])])->setName('opclasses.sql');
    Route::delete('/databases/{db}/schemas/{scid:number}/opclasses/{kind}/{oid:number}', function (ServerRequestInterface $request, array $args) use ($context): array {
        $ctx = $context($request, $args, 'type');
        (new OperatorClassController())->delete($ctx, (string) $args['kind'], (int) $args['oid'], $ctx->flag('cascade'));

        return ['ok' => true];
    })->setName('opclasses.delete');
    Route::get('/databases/{db}/schemas/{scid:number}/fts_templates/options', fn (ServerRequestInterface $request, array $args): array => (new FtsTemplateController())->options($context($request, $args, 'fts_template')))->setName('fts_templates.options');
});
