<?php

declare(strict_types=1);

namespace PhpPgAdmin\Core\Sql;

/**
 * Jinja's namespace() object for templates: a bag of values a loop body can change, since
 * {% set %} inside a for loop is scoped to the iteration in Twig as in Jinja.
 *
 *     {% set ns = namespace({first: true}) %}
 *     {% for x in xs %}{% if ns.first %}{% do ns.set('first', false) %}{% endif %}{% endfor %}
 */
final class TemplateNamespace
{
    /** @param array<string, mixed> $values */
    public function __construct(private array $values = [])
    {
    }

    public function __get(string $name): mixed
    {
        return $this->values[$name] ?? null;
    }

    public function __isset(string $name): bool
    {
        return isset($this->values[$name]);
    }

    public function set(string $name, mixed $value): void
    {
        $this->values[$name] = $value;
    }

    /** Twig's attribute lookup reaches this for `ns.name`. */
    public function get(string $name): mixed
    {
        return $this->values[$name] ?? null;
    }
}
